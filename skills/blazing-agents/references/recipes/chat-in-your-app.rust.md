# Add chat to your app: Rust code

The Rust code for the steps of [Add chat to your app](chat-in-your-app.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Install the crates

```bash
cargo add blazing-agents axum serde serde_json tokio --features tokio/full,serde/derive
```

`client.for_user(user_id)?` returns a `UserClient` that sends the scope on every request. Relay the `ChatStream` bytes unchanged and copy the `Location` header on the first Turn. The SDK percent-encodes every path segment and rejects an empty, `.`, or `..` value as `Error::InvalidArgument`, so a browser ID cannot leave its segment.

## Step 2: Add the backend

```rust
use axum::body::Body;
use axum::extract::{Json, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use blazing_agents::chat::{ChatInput, ChatStream, ToolApprovalDecision};
use blazing_agents::messages::UserMessage;
use blazing_agents::{Client, Error};
use blazing_agents::pagination::Cursor;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct ChatBody {
    message: Option<Value>,
    messages: Option<Vec<Value>>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(rename = "messageId")]
    message_id: Option<String>,
    trigger: Option<Trigger>,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum Trigger {
    SubmitMessage,
    RegenerateMessage,
}

#[derive(Deserialize)]
struct HistoryQuery {
    #[serde(rename = "sessionId")]
    session_id: String,
    cursor: Option<String>,
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

fn relay(stream: ChatStream, new_session: bool) -> Response {
    let mut response = Response::builder()
        .header("cache-control", "no-cache")
        .header("content-type", "text/event-stream")
        .header("x-vercel-ai-ui-message-stream", "v1");
    if let Some(turn_id) = stream.meta().headers().get("x-ba-turn-id") {
        response = response.header("x-ba-turn-id", turn_id.clone());
    }
    if new_session {
        if let Some(location) = stream.meta().headers().get("location") {
            response = response.header("location", location.clone());
        }
    }
    response
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn failure(error: Error) -> Response {
    match error {
        Error::InvalidArgument(_) => StatusCode::BAD_REQUEST.into_response(),
        Error::Api(api) => (
            StatusCode::from_u16(api.status()).unwrap_or(StatusCode::BAD_GATEWAY),
            Json(json!({ "error": { "code": api.code().as_str() } })),
        )
            .into_response(),
        _ => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": { "code": "upstream_error" } })),
        )
            .into_response(),
    }
}

async fn history(
    State(client): State<Client>,
    headers: HeaderMap,
    Query(query): Query<HistoryQuery>,
) -> Response {
    let user_id = current_user(&headers);
    let Ok(scoped) = client.for_user(&user_id) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let mut call = scoped
        .sessions()
        .messages(agent_for_user(&user_id), query.session_id)
        .limit(200);
    if let Some(cursor) = query.cursor {
        call = call.cursor(Cursor::from(cursor));
    }
    call.await
        .map(|page| {
            Json(json!({
                "messages": page.data,
                "nextCursor": page.next_cursor,
            }))
            .into_response()
        })
        .unwrap_or_else(failure)
}

async fn chat(
    State(client): State<Client>,
    headers: HeaderMap,
    Json(body): Json<ChatBody>,
) -> Response {
    let user_id = current_user(&headers);
    let Ok(scoped) = client.for_user(&user_id) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let agent_id = agent_for_user(&user_id);

    let message = body.message.clone().unwrap_or(Value::Null);
    let is_approval = body.messages.is_none()
        && message.get("role").and_then(Value::as_str) == Some("assistant");

    let result = if is_approval {
        // The frontend posts the answered assistant message; its tool parts
        // after the last step-start carry the round's decisions.
        let decisions = approval_decisions(&message);
        match (&body.session_id, decisions.is_empty()) {
            (Some(session_id), false) => scoped
                .continue_chat(agent_id, session_id, decisions)
                .await
                .map(|stream| relay(stream, false)),
            _ => Err(Error::InvalidArgument("Invalid approval.".to_owned())),
        }
    } else {
        let raw = match (&body.messages, body.message) {
            (Some(messages), _) => messages.clone(),
            (None, Some(message)) => vec![message],
            _ => vec![],
        };
        let parsed: Result<Vec<UserMessage>, _> =
            raw.iter().cloned().map(serde_json::from_value).collect();
        match parsed {
            Err(_) => Err(Error::InvalidArgument("Invalid message.".to_owned())),
            Ok(messages) if body.messages.is_some() => match &body.session_id {
                // Waiting messages go out as one batch once the Session is idle.
                Some(session_id) => match ChatInput::try_from(messages) {
                    Ok(input) => scoped
                        .chat(agent_id, input)
                        .session(session_id)
                        .await
                        .map(|stream| relay(stream, false)),
                    Err(_) => Err(Error::InvalidArgument("Invalid message.".to_owned())),
                },
                None => Err(Error::InvalidArgument("A batch needs a Session.".to_owned())),
            },
            Ok(messages) => {
                let Some(message) = messages.into_iter().next() else {
                    return StatusCode::BAD_REQUEST.into_response();
                };
                match &body.session_id {
                    None => scoped
                        .chat(agent_id, message)
                        .await
                        .map(|stream| relay(stream, true)),
                    Some(session_id) if body.trigger == Some(Trigger::RegenerateMessage) => {
                        let call = scoped.regenerate(agent_id, session_id, message);
                        let call = match &body.message_id {
                            Some(message_id) => call.message_id(message_id),
                            None => call,
                        };
                        call.await.map(|stream| relay(stream, false))
                    }
                    Some(session_id) => scoped
                        .chat(agent_id, message)
                        .session(session_id)
                        .await
                        .map(|stream| relay(stream, false)),
                }
            }
        }
    };
    result.unwrap_or_else(failure)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = Router::new()
        .route("/api/chat", post(chat))
        .route("/api/chat/history", get(history))
        .with_state(Client::from_env()?);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

## Step 3: Add the Session endpoints

```rust
use axum::extract::{Json, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use blazing_agents::messages::UserMessage;
use blazing_agents::{Client, Error};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct SessionQuery {
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[derive(Deserialize)]
struct SteerBody {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "requestId")]
    request_id: String,
    message: UserMessage,
}

#[derive(Deserialize)]
struct StopBody {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "turnId")]
    turn_id: String,
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

fn failure(error: Error) -> Response {
    match error {
        Error::Api(api) => (
            StatusCode::from_u16(api.status()).unwrap_or(StatusCode::BAD_GATEWAY),
            Json(json!({ "error": { "code": api.code().as_str() } })),
        )
            .into_response(),
        _ => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": { "code": "upstream_error" } })),
        )
            .into_response(),
    }
}

async fn session(
    State(client): State<Client>,
    headers: HeaderMap,
    Query(query): Query<SessionQuery>,
) -> Response {
    let user_id = current_user(&headers);
    let Ok(scoped) = client.for_user(&user_id) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    // Terminal receipts too: include_completed returns committed and
    // not_placed inputs, and activity says what the Session is doing.
    scoped
        .sessions()
        .inputs(agent_for_user(&user_id), query.session_id)
        .include_completed(true)
        .await
        .map(|page| Json(json!(page)).into_response())
        .unwrap_or_else(failure)
}

async fn steer(
    State(client): State<Client>,
    headers: HeaderMap,
    Json(body): Json<SteerBody>,
) -> Response {
    let user_id = current_user(&headers);
    let Ok(scoped) = client.for_user(&user_id) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    scoped
        .sessions()
        .submit_input(
            agent_for_user(&user_id),
            body.session_id,
            body.request_id,
            body.message,
        )
        .await
        .map(|receipt| Json(json!(receipt)).into_response())
        .unwrap_or_else(failure)
}

async fn stop(
    State(client): State<Client>,
    headers: HeaderMap,
    Json(body): Json<StopBody>,
) -> Response {
    let user_id = current_user(&headers);
    let Ok(scoped) = client.for_user(&user_id) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    scoped
        .sessions()
        .stop(agent_for_user(&user_id), body.session_id, body.turn_id)
        .await
        .map(|result| Json(json!(result)).into_response())
        .unwrap_or_else(failure)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = Router::new()
        .route("/api/chat/session", get(session))
        .route("/api/chat/steer", post(steer))
        .route("/api/chat/stop", post(stop))
        .with_state(Client::from_env()?);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```
