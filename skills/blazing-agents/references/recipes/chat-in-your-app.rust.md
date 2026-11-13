# Add chat to your app: Rust code

The Rust code for the steps of [Add chat to your app](chat-in-your-app.md). Read that file first: it explains each step, its decisions, and its gotchas. Step 3, the React chat, is the same for every backend.

## Step 1: Install the crates

```bash
cargo add blazing-agents axum serde serde_json tokio --features tokio/full,serde/derive
```

The Rust SDK has no relay helper, so the backend implements the [browser relay contract](https://github.com/blazingagents/typescript-sdk/blob/main/docs/relay-contract.md) that `useBlazingAgentsChat` speaks. Every request is a JSON `POST` to one route, and its `op` selects the operation:

| `op` | Body | Scoped client call | Answer |
| --- | --- | --- | --- |
| `chat` | `message`, and optional `sessionId`, `messageId`, `trigger` | `chat()` or `regenerate()` for a user message, `continue_chat()` for an assistant message that answers an approval round | The stream, with the `Location` header on a new Session |
| `history` | `sessionId`, optional `cursor` | `sessions().messages()` with `.limit(200)` | `200` with `{"data": [...], "nextCursor": ...}`: one page, forwarded as it is |
| `steer` | `sessionId`, `requestId`, `message` | `sessions().submit_input()` | `202` with `{"state": ...}` |

`client.for_user(user_id)?` returns a `UserClient` that sends the scope on every request. The SDK percent-encodes every path segment and rejects an empty, `.`, or `..` value as `Error::InvalidArgument`, so a browser ID cannot leave its segment. Every error body is `{"error": {"code": ..., "message": ...}}`, with the API's status and code when the API refused the call. The browser reads the remaining history pages itself and validates the messages, so the relay forwards one page without a paging loop.

## Step 2: Add the relay

```rust
use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use blazing_agents::chat::{ChatStream, ToolApprovalDecision};
use blazing_agents::ids::AgentId;
use blazing_agents::messages::UserMessage;
use blazing_agents::pagination::Cursor;
use blazing_agents::{Client, Error, UserClient};
use serde::Deserialize;
use serde_json::{Value, json};

/// One request body per op; serde ignores keys it does not know.
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
enum RelayRequest {
    Chat {
        message: Value,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
        #[serde(rename = "messageId")]
        message_id: Option<String>,
        trigger: Option<Trigger>,
    },
    History {
        #[serde(rename = "sessionId")]
        session_id: String,
        cursor: Option<String>,
    },
    Steer {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "requestId")]
        request_id: String,
        message: UserMessage,
    },
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum Trigger {
    SubmitMessage,
    RegenerateMessage,
}

fn signed_in_user_id(headers: &HeaderMap) -> Option<String> {
    // Your sign-in check: verify the session token and return its user ID.
    let _ = headers;
    todo!("verify the signed-in user")
}

/// The user's own Agent, which comes with its own Workspace.
async fn agent_for(user: &UserClient) -> Result<AgentId, Error> {
    if let Some(agent) = user.agents().list().limit(1).await?.data.into_iter().next() {
        return Ok(agent.id);
    }
    let provider_id = std::env::var("BLAZING_AGENTS_PROVIDER_ID").unwrap_or_default();
    let agent = user
        .agents()
        .create("Chat assistant")
        .model(provider_id, "openai/gpt-6-luna")
        .await?;
    Ok(agent.id)
}

fn approval_decisions(message: &Value) -> Vec<ToolApprovalDecision> {
    // The round's decisions: answered tool parts after the last step-start.
    let Some(parts) = message.get("parts").and_then(Value::as_array) else {
        return Vec::new();
    };
    let last_step = parts
        .iter()
        .rposition(|part| part.get("type").and_then(Value::as_str) == Some("step-start"))
        .map(|index| index + 1)
        .unwrap_or(0);
    parts[last_step..]
        .iter()
        .filter(|part| part.get("state").and_then(Value::as_str) == Some("approval-responded"))
        .filter_map(|part| {
            let approval = part.get("approval")?;
            let id = approval.get("id")?.as_str()?;
            let decision = match approval.get("approved")?.as_bool()? {
                true => ToolApprovalDecision::approve(id),
                false => ToolApprovalDecision::deny(id),
            };
            Some(match approval.get("reason").and_then(Value::as_str) {
                Some(reason) => decision.reason(reason),
                None => decision,
            })
        })
        .collect()
}

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({ "error": { "code": code, "message": message } })),
    )
        .into_response()
}

fn failure(error_value: Error) -> Response {
    match error_value {
        Error::InvalidArgument(_) => error(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "Invalid request body.",
        ),
        Error::Api(api) => {
            let status = StatusCode::from_u16(api.status()).unwrap_or(StatusCode::BAD_GATEWAY);
            let mut response = error(status, api.code().as_str(), api.message());
            if let Some(request_id) = api.request_id().and_then(|id| id.parse().ok()) {
                response.headers_mut().insert("x-request-id", request_id);
            }
            response
        }
        Error::Stream(_) => error(
            StatusCode::BAD_GATEWAY,
            "stream_error",
            "The stream failed.",
        ),
        Error::Connection(_) | Error::Timeout => error(
            StatusCode::BAD_GATEWAY,
            "network_error",
            "Unable to reach Blazing Agents.",
        ),
        _ => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "Internal error.",
        ),
    }
}

fn relay_stream(stream: ChatStream) -> Response {
    let mut response = Response::builder()
        .header("cache-control", "no-cache")
        .header("content-type", "text/event-stream")
        .header("x-vercel-ai-ui-message-stream", "v1");
    for name in ["location", "x-ba-turn-id", "x-request-id"] {
        if let Some(value) = stream.meta().headers().get(name) {
            response = response.header(name, value.clone());
        }
    }
    response
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn relay_chat(
    user: &UserClient,
    agent_id: AgentId,
    message: Value,
    session_id: Option<String>,
    message_id: Option<String>,
    trigger: Option<Trigger>,
) -> Result<Response, Error> {
    if message.get("role").and_then(Value::as_str) == Some("assistant") {
        let decisions = approval_decisions(&message);
        return match session_id {
            Some(session_id) if !decisions.is_empty() => Ok(relay_stream(
                user.continue_chat(agent_id, session_id, decisions).await?,
            )),
            _ => Ok(error(
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "Invalid approval.",
            )),
        };
    }
    let Ok(message) = serde_json::from_value::<UserMessage>(message) else {
        return Ok(error(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "Invalid chat message.",
        ));
    };
    let stream = match session_id {
        None => user.chat(agent_id, message).await?,
        Some(session_id) if trigger == Some(Trigger::RegenerateMessage) => {
            let call = user.regenerate(agent_id, session_id, message);
            match message_id {
                Some(message_id) => call.message_id(message_id).await?,
                None => call.await?,
            }
        }
        Some(session_id) => user.chat(agent_id, message).session(session_id).await?,
    };
    Ok(relay_stream(stream))
}

async fn relay_history(
    user: &UserClient,
    agent_id: AgentId,
    session_id: String,
    cursor: Option<String>,
) -> Result<Response, Error> {
    let mut call = user.sessions().messages(agent_id, session_id).limit(200);
    if let Some(cursor) = cursor {
        call = call.cursor(Cursor::from(cursor));
    }
    let page = call.await?;
    Ok(Json(json!({ "data": page.data, "nextCursor": page.next_cursor })).into_response())
}

async fn relay_steer(
    user: &UserClient,
    agent_id: AgentId,
    session_id: String,
    request_id: String,
    message: UserMessage,
) -> Result<Response, Error> {
    let receipt = user
        .sessions()
        .submit_input(agent_id, session_id, request_id, message)
        .await?;
    let state = receipt.input.state.as_str();
    Ok((StatusCode::ACCEPTED, Json(json!({ "state": state }))).into_response())
}

async fn relay(State(client): State<Client>, headers: HeaderMap, body: Bytes) -> Response {
    let unauthorized = || {
        error(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Authentication required.",
        )
    };
    let Some(user_id) = signed_in_user_id(&headers) else {
        return unauthorized();
    };
    let Ok(user) = client.for_user(&user_id) else {
        return unauthorized();
    };
    let Ok(request) = serde_json::from_slice::<RelayRequest>(&body) else {
        return error(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "Invalid request body.",
        );
    };
    let agent_id = match agent_for(&user).await {
        Ok(agent_id) => agent_id,
        Err(err) => return failure(err),
    };
    let result = match request {
        RelayRequest::Chat {
            message,
            session_id,
            message_id,
            trigger,
        } => relay_chat(&user, agent_id, message, session_id, message_id, trigger).await,
        RelayRequest::History { session_id, cursor } => {
            relay_history(&user, agent_id, session_id, cursor).await
        }
        RelayRequest::Steer {
            session_id,
            request_id,
            message,
        } => relay_steer(&user, agent_id, session_id, request_id, message).await,
    };
    result.unwrap_or_else(failure)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = Router::new()
        .route("/api/chat", post(relay))
        .with_state(Client::from_env()?);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

For a relay on another origin, expose the `Location` and `X-Request-Id` headers through CORS, for example with `tower-http`'s `CorsLayer::expose_headers`, so the browser can read the new Session ID.
