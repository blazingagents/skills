# Require approval before your agent runs a tool: Rust code

The Rust code for the steps of [Require approval before your agent runs a tool](human-approval.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Set the policies

```rust
use blazing_agents::agents::{AgentTool, ApprovalDecision, ApprovalPolicy, ToolReference};

let mcp_connection_id = "mcp_0123456789abcdef";
client
    .agents()
    .update("ag_0123456789abcdef")
    .approval_in_chat(
        ApprovalPolicy::new(ApprovalDecision::Full)
            .with_override(
                ToolReference::builtin(AgentTool::Bash),
                ApprovalDecision::Manual,
            )
            .with_override(
                ToolReference::mcp(mcp_connection_id, "refund_order"),
                ApprovalDecision::Manual,
            )
            .with_override(
                ToolReference::mcp(mcp_connection_id, "send_email"),
                ApprovalDecision::Auto,
            ),
    )
    .approval_in_tasks(
        ApprovalPolicy::new(ApprovalDecision::Deny)
            .with_override(ToolReference::builtin(AgentTool::Read), ApprovalDecision::Full),
    )
    .await?;
```

## Step 2: After a chat stream ends, list the Session's approvals on your backend and send the pending ones to the reviewer

```rust
use axum::extract::{Json, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use blazing_agents::sessions::ToolApprovalStatus;
use blazing_agents::{Client, Error};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct ApprovalsQuery {
    #[serde(rename = "sessionId")]
    session_id: String,
}

fn current_user(headers: &HeaderMap) -> String {
    // Your sign-in check: verify the session token and return its user ID.
    let _ = headers;
    todo!("verify the signed-in user")
}

fn agent_for_user(_user_id: &str) -> String {
    // Read this user's Agent ID from trusted backend state.
    "ag_0123456789abcdef".to_owned()
}

async fn list_pending(
    State(client): State<Client>,
    headers: HeaderMap,
    Query(query): Query<ApprovalsQuery>,
) -> Response {
    let user_id = current_user(&headers);
    let Ok(scoped) = client.for_user(&user_id) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    scoped
        .sessions()
        .tool_approvals(agent_for_user(&user_id), query.session_id)
        .await
        .map(|approvals| {
            let pending: Vec<_> = approvals
                .data
                .iter()
                .filter(|item| item.decision == ToolApprovalStatus::Pending)
                .map(|item| {
                    json!({
                        "approvalId": item.approval_id,
                        "tool": item
                            .tool
                            .as_ref()
                            .map_or_else(|| json!(item.tool_name), |tool| json!(tool)),
                        "input": item.input,
                    })
                })
                .collect();
            Json(json!({ "pending": pending })).into_response()
        })
        .unwrap_or_else(|error| {
            (
                match error {
                    Error::Api(api) => {
                        StatusCode::from_u16(api.status()).unwrap_or(StatusCode::BAD_GATEWAY)
                    }
                    _ => StatusCode::BAD_GATEWAY,
                },
                Json(json!({ "error": "upstream" })),
            )
                .into_response()
        })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = Router::new()
        .route("/api/tool-approvals", get(list_pending))
        .with_state(Client::from_env()?);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

## Step 3: Send the complete round of decisions in one call

```rust
use axum::body::Body;
use axum::extract::{Json, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::post;
use axum::Router;
use blazing_agents::chat::ToolApprovalDecision;
use blazing_agents::Client;
use serde::Deserialize;

#[derive(Deserialize)]
struct Decision {
    #[serde(rename = "approvalId")]
    approval_id: String,
    approved: bool,
    reason: Option<String>,
}

#[derive(Deserialize)]
struct ContinueBody {
    #[serde(rename = "sessionId")]
    session_id: String,
    decisions: Vec<Decision>,
}

fn current_user(headers: &HeaderMap) -> String {
    // Your sign-in check: verify the session token and return its user ID.
    let _ = headers;
    todo!("verify the signed-in user")
}

fn agent_for_user(_user_id: &str) -> String {
    // Read this user's Agent ID from trusted backend state.
    "ag_0123456789abcdef".to_owned()
}

async fn continue_round(
    State(client): State<Client>,
    headers: HeaderMap,
    Json(body): Json<ContinueBody>,
) -> Result<Response, StatusCode> {
    let user_id = current_user(&headers);
    if body.decisions.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let decisions = body.decisions.iter().map(|d| {
        let decision = if d.approved {
            ToolApprovalDecision::approve(&d.approval_id)
        } else {
            ToolApprovalDecision::deny(&d.approval_id)
        };
        match &d.reason {
            Some(reason) => decision.reason(reason.clone()),
            None => decision,
        }
    });
    let scoped = client.for_user(&user_id).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let stream = scoped
        .continue_chat(agent_for_user(&user_id), &body.session_id, decisions)
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    let mut response = Response::builder()
        .header("content-type", "text/event-stream")
        .header("x-vercel-ai-ui-message-stream", "v1");
    if let Some(turn_id) = stream.meta().headers().get("x-ba-turn-id") {
        response = response.header("x-ba-turn-id", turn_id.clone());
    }
    response
        .body(Body::from_stream(stream))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = Router::new()
        .route("/api/tool-approvals/continue", post(continue_round))
        .with_state(Client::from_env()?);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```
