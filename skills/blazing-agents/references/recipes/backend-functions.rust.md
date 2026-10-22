# Let a chat agent call your backend functions: Rust code

The Rust code for the steps of [Let a chat agent call your backend functions](backend-functions.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Add the functions inside your chat route, after authenticating the request, so every handler closes over the verified user

```rust
use anyhow::anyhow;
use axum::body::Body;
use axum::extract::{Json, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::post;
use axum::Router;
use blazing_agents::functions::{FunctionContext, Functions};
use blazing_agents::messages::UserMessage;
use blazing_agents::Client;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize, JsonSchema)]
struct OrderInput {
    order_id: String,
}

#[derive(Deserialize)]
struct ChatBody {
    message: UserMessage,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
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

async fn find_order(_user_id: &str, _order_id: &str) -> Option<serde_json::Value> {
    // Your database lookup, scoped to this user.
    None
}

async fn chat(
    State(client): State<Client>,
    headers: HeaderMap,
    Json(body): Json<ChatBody>,
) -> Result<Response, StatusCode> {
    let user_id = current_user(&headers);

    let functions = Functions::builder()
        .function(
            "orderLookup",
            "Look up one of the signed-in user's orders by ID.",
            {
                let user_id = user_id.clone();
                move |input: OrderInput, context: FunctionContext| {
                    let user_id = user_id.clone();
                    async move {
                        // Queries only this user's rows. context.is_cancelled()
                        // reports the call's deadline or a dropped stream;
                        // context.idempotency_key() names this one execution.
                        let _ = context;
                        let order = find_order(&user_id, &input.order_id).await;
                        Ok::<_, anyhow::Error>(
                            order.unwrap_or_else(|| json!({"found": false})),
                        )
                    }
                }
            },
        )
        .build()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let scoped = client
        .for_user(&user_id)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    let call = scoped
        .chat(agent_for_user(&user_id), body.message)
        .functions(functions);
    let stream = match &body.session_id {
        Some(session_id) => call.session(session_id),
        None => call,
    }
    .await
    .map_err(|_| StatusCode::BAD_GATEWAY)?;

    let mut response = Response::builder()
        .header("content-type", "text/event-stream")
        .header("x-vercel-ai-ui-message-stream", "v1");
    if let Some(turn_id) = stream.meta().headers().get("x-ba-turn-id") {
        response = response.header("x-ba-turn-id", turn_id.clone());
    }
    if body.session_id.is_none() {
        if let Some(location) = stream.meta().headers().get("location") {
            response = response.header("location", location);
        }
    }
    response
        .body(Body::from_stream(stream))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = Router::new()
        .route("/api/chat", post(chat))
        .with_state(Client::from_env()?);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

## Step 2: Continue with the functions after an approval pause

```rust
use axum::body::Body;
use axum::response::Response;
use blazing_agents::chat::ToolApprovalDecision;
use blazing_agents::functions::{Functions, FunctionsError};

fn chat_functions_for(_user_id: &str) -> Result<Functions, FunctionsError> {
    // The same functions as the chat route, built for the Session's owner.
    Functions::builder().build()
}

let session_owner_id = "user_123"; // the Session's owner, from your records
let decisions = vec![ToolApprovalDecision::approve("apr_0123456789abcdef")];

let stream = client
    .for_user(session_owner_id)?
    .continue_chat(
        "ag_0123456789abcdef",
        "ss_0123456789abcdef",
        decisions,
    )
    .functions(chat_functions_for(session_owner_id)?)
    .await?;
let mut response = Response::builder()
    .header("x-vercel-ai-ui-message-stream", "v1")
    .header("content-type", "text/event-stream");
if let Some(turn_id) = stream.meta().headers().get("x-ba-turn-id") {
    response = response.header("x-ba-turn-id", turn_id.clone());
}
let response = response.body(Body::from_stream(stream))?;
let _ = response;
```
