# Add chat to your app: Rust code

The Rust code for the steps of [Add chat to your app](chat-in-your-app.md). Read that file first: it explains each step, its decisions, and its gotchas. Step 3, the browser chat, is the same for every backend.

## Step 1: Install the crates

```bash
cargo add blazing-agents axum tokio --features tokio/full
```

## Step 2: Add the relay

`blazing_agents::relay::ChatRelay` answers the browser's `chat`, `history`, and `steer` requests by the [browser relay contract](https://github.com/blazingagents/typescript-sdk/blob/main/docs/relay-contract.md). `ChatRelay::new(client, resolve_context)` calls `resolve_context` with each request and its whole body. It returns `Ok(Some(RelayContext))` with the signed-in user and their Agent, `Ok(None)`, which the relay answers with `401`, or an error, which the relay answers with `500`. The relay then sends every API request through `client.for_user(user_id)`, and never reads the user or the Agent from the request body. `ChatRelay::handle` takes any `http::Request` and returns a `Response<RelayBody>`, which axum, hyper, and tower serve as it is.

```rust
use axum::Router;
use axum::extract::{Request, State};
use axum::http::HeaderMap;
use axum::response::Response;
use axum::routing::post;
use blazing_agents::ids::AgentId;
use blazing_agents::relay::{ChatRelay, RelayBody, RelayContext};
use blazing_agents::{Client, Error};

fn signed_in_user_id(headers: &HeaderMap) -> Option<String> {
    // Your sign-in check: verify the session token and return its user ID.
    let _ = headers;
    todo!("verify the signed-in user")
}

/// The user's own Agent, which comes with its own Workspace.
async fn agent_for(client: &Client, user_id: &str) -> Result<AgentId, Error> {
    let user = client.for_user(user_id)?;
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

async fn chat(State(relay): State<ChatRelay>, request: Request) -> Response<RelayBody> {
    relay.handle(request).await
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let client = Client::from_env()?;
    let relay = ChatRelay::new(client.clone(), move |request| {
        let client = client.clone();
        async move {
            let Some(user_id) = signed_in_user_id(request.headers()) else {
                return Ok(None);
            };
            let agent_id = agent_for(&client, &user_id).await?;
            Ok(Some(RelayContext::new(agent_id, user_id)))
        }
    });
    let app = Router::new().route("/api/chat", post(chat)).with_state(relay);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

For backend functions and attribution, add them with `RelayContext::functions` and `RelayContext::metadata`. For a relay on another origin, expose the `Location` and `X-Request-Id` headers through CORS, for example with `tower-http`'s `CorsLayer::expose_headers`, so the browser can read the new Session ID.
