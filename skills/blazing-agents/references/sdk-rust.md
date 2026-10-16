# Rust SDK reference

Use this page to call Blazing Agents from a Rust backend: install the crate, build a client, run Turns, and find the method for every operation. It matches the `blazing-agents` crate at rev `789a123` of the repository's main branch, the revision this skill's snippets compile against. The crate is not on crates.io yet, so install it from the repository.

For the same surface in Python or TypeScript, read [Python SDK reference](sdk-python.md) or [TypeScript SDK reference](sdk-typescript.md). For end-to-end builds, start from a recipe such as [Add chat to your app](recipes/chat-in-your-app.md).

The snippets on this page assume a `client` built as shown in [Construct](#construct); short fragments appear inside an async function that receives it.

## Install

The crate is `blazing-agents`; the import name is `blazing_agents`. It needs Rust 1.85 or newer and runs on Tokio.

```bash
cargo add blazing-agents --git https://github.com/blazingagents/rust-sdk --rev 789a123
cargo add tokio --features macros,rt-multi-thread
cargo add futures-util
```

```toml
[dependencies]
blazing-agents = { git = "https://github.com/blazingagents/rust-sdk", rev = "789a12397333868577404b4d9bafaee89446e4d0" }
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
futures-util = "0.3"
```

`futures-util` gives you `TryStreamExt` for the SDK's streams. TLS uses rustls by default; for OpenSSL instead, depend with `default-features = false, features = ["native-tls", "schemars"]`; keep `schemars` or you lose schema derivation and typed function inputs.

Keep the Tenant API key in `BLAZING_AGENTS_API_KEY` on your backend. It can reach everything in your Tenant, so it never goes to a browser or mobile app.

## The async client and Tokio

There is one async `Client`. Every method returns a `Call`: required inputs are arguments, optional inputs are setters, and `.await` sends it. A `Call` is `Send + 'static`, so it can move into `tokio::spawn`. Streams are `futures` streams; read them with `TryStreamExt::try_next()` or `StreamExt::next()`.

## Construct

Create one client per process and reuse it; cloning is cheap and shares the connection pool. `Client::from_env()` reads `BLAZING_AGENTS_API_KEY` and fails with `ConfigError::MissingApiKey` when it is unset or empty. `Client::builder()` builds the same client with options; building makes no network request.

```rust
use blazing_agents::Client;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let client = Client::from_env()?;
    let reply = client
        .completion("ag_0123456789abcdef", "Write a friendly welcome message.")
        .await?;
    println!("{reply}");
    Ok(())
}
```

Builder options:

| Setter | Default | Use |
| --- | --- | --- |
| `api_key(key)` | `BLAZING_AGENTS_API_KEY` | Tenant API key |
| `base_url(url)` | `https://api.blazingagents.com` | API origin; trailing slashes are removed |
| `timeout(Option<Duration>)` | 60 seconds | `None` disables it. A stream's timeout covers only the wait for headers |
| `connect_timeout(Duration)` | none | TCP connect timeout |
| `default_header(name, value)` | none | Header sent on every request. `Authorization`, `Content-Type`, `X-Request-Id` and `X-BA-User-Id` are ignored |
| `on_response(callback)` | none | `Fn(&ResponseObservation)` (`operation_id`, `method`, `path`, `status`, `duration`, `request_id`, `client_request_id`) called per response |

`client.with_client_request_id("checkout-42")` returns a client that tags every request with your correlation ID. Every call also accepts `with_header`, `with_client_request_id`, `with_timeout`, and `without_timeout`, and `send_with_meta()` returns the value plus the response status, headers, and server request ID. The SDK retries transient claim and result submissions for backend functions; other requests do not retry on their own.

## Run Turns: generation methods

The client itself has the generation methods. Each call runs one metered Turn. The prompt argument is a `PromptInput`: pass a `&str` for literal text or `SavedPrompt::new(prompt_id).var("name", "value")` for a saved Prompt, and supply exactly the names its `variables` lists. `chat()` also takes a `UserMessage`, or a `Vec<UserMessage>` (converted with `try_into()`, which fails on an empty batch) for messages your client held while the Session was busy. Every call also accepts `.user_id()` and `.metadata()` for Attribution to your end user.

| Method | `.await` returns | Use it for |
| --- | --- | --- |
| `client.chat(agent_id, input)` | `ChatStream` | A conversation stored as a Session. `.session(id)` resumes one |
| `client.regenerate(agent_id, session_id, input)` | `ChatStream` | The answer again; `.message_id(id)` cuts history back first |
| `client.completion(agent_id, prompt)` | `String` | Stateless text, buffered |
| `client.completion_stream(agent_id, prompt)` | `CompletionStream` of `String` deltas | Stateless text, streamed. `final_text()` returns the whole text |
| `client.object::<T>(agent_id, prompt, schema)` | `T` | Structured output, validated |
| `client.object_stream::<T>(agent_id, prompt, schema)` | `ObjectStream<T>` of raw JSON `String` deltas | Structured output, streamed. `final_object()` validates at the end |

`continue_chat(agent_id, session_id, decisions)` is not a generation method: it decides a Session's complete approval round, with backend functions attached through `.functions(...)`, and returns a `ChatStream` for the continuing Turn. See [Backend functions](#backend-functions).

### Chat returns raw SSE bytes and a Session ID

`chat()` returns a `ChatStream`. It is a `Stream` whose items are the server's AI SDK UI message stream as raw SSE `Bytes`, one complete event per item, exactly as sent. The SDK does not decode it. Relay those bytes to your frontend, where `useChat` from `@ai-sdk/react` reads them.

`stream.session_id()` holds the `ss_...` ID before you read the body, and `stream.turn_id()` holds the running `turn_...` ID for `sessions().stop()`. Call `chat` without `.session()` to start a new Session. Store the returned ID with your user, send it to your frontend, and pass it back through `.session()` to continue that conversation.

```rust
use blazing_agents::Client;
use blazing_agents::chat::ChatStream;
use blazing_agents::messages::UserMessage;

async fn start_chat(
    client: &Client,
    user_id: &str,
    message: UserMessage,
    session_id: Option<&str>,
) -> blazing_agents::Result<ChatStream> {
    // message is the AI SDK UIMessage from your frontend: {"id", "role", "parts"}.
    let call = client.chat("ag_0123456789abcdef", message).user_id(user_id);
    match session_id {
        Some(session_id) => call.session(session_id).await,
        None => call.await,
    }
}
```

To relay, turn the stream into your framework's streaming body. In axum that is `Body::from_stream(stream)` with the `x-vercel-ai-ui-message-stream: v1` header, plus `x-ba-turn-id` (the running Turn's `turn_...` ID, used for Stop). When the call started a new Session, also copy the response's `location` header from `stream.meta().headers()`: `BlazingAgentsChatTransport` in your frontend reads the new Session ID from that header.

```rust
use axum::body::Body;
use axum::extract::{Json, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use axum::Router;
use blazing_agents::messages::UserMessage;
use blazing_agents::Client;
use serde::Deserialize;

#[derive(Deserialize)]
struct ChatBody {
    message: UserMessage,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}

async fn chat(
    State(client): State<Client>,
    Json(body): Json<ChatBody>,
) -> Result<Response, StatusCode> {
    let call = client.chat("ag_0123456789abcdef", body.message);
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
            response = response.header("location", location.clone());
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

The full endpoint, including batches and approval continuations, is in [Add chat to your app](recipes/chat-in-your-app.md).

Outside a web request, iterate the chunks yourself:

```rust
use blazing_agents::Client;
use blazing_agents::messages::UserMessage;
use futures_util::TryStreamExt;

let client = Client::from_env()?;
let message: UserMessage = serde_json::from_str(
    r#"{"id":"msg-1","role":"user","parts":[{"type":"text","text":"Hello"}]}"#,
)?;
let mut stream = client.chat("ag_0123456789abcdef", message).await?;
println!("Session: {}", stream.session_id());
while let Some(chunk) = stream.try_next().await? {
    // Raw SSE bytes. Forward, log, or store them as you need.
    print!("{}", String::from_utf8_lossy(&chunk));
}
```

Chat rules the SDK's types enforce before sending:

- A resumed Session is `.session(id)` on the call, not an optional argument, so a missing ID cannot reach the wire.
- `regenerate` needs a `session_id` as an argument and can cut back to `.message_id(id)`.
- `SavedPrompt` variables go out as `promptId` plus `variables`; a literal `Vec<UserMessage>` converts only when it is nonempty.

### Backend functions

`Functions::builder()` collects function definitions and their handlers, and `.build()` checks them against the platform's limits. `.function(name, description, handler)` derives the input schema from the handler's input type (with the `schemars` feature); `.function_json(name, description, input_schema, handler)` takes a hand-written JSON Schema and passes the handler a `serde_json::Value`. The handler gets the validated input and a `FunctionContext` (`idempotency_key()`, `deadline()`, `is_cancelled()`, `cancelled().await`) and returns `Result<O, E>` where `O: Serialize` and `E` converts into a boxed error. Attach the `Functions` with `.functions(...)` on `chat`, `regenerate`, or `continue_chat`. `Functions` is cheap to clone; attach the same value to every call. Each function's claim and result requests carry the call's `with_header` values and `with_client_request_id`.

`client.continue_chat(agent_id, session_id, decisions)` records every decision in the round (`ToolApprovalDecision::approve(id)` or `ToolApprovalDecision::deny(id).reason("...")`), reattaches your handlers, and streams the continuing Turn. Keep consuming the stream: function calls dispatch as you read their events. For end-to-end setup, including scoping and approval flow, read [backend functions](recipes/backend-functions.md).

### Structured output

`object` and `object_stream` take an `ObjectSchema<T>`: `ObjectSchema::<T>::derive()` derives the JSON Schema from `T` (with the `schemars` feature, on by default) and decodes the result into `T`. `ObjectSchema::from_json_schema(schema)` takes a raw schema; with `T = serde_json::Value` the final JSON is returned without further validation.

```rust
use blazing_agents::Client;
use blazing_agents::generation::ObjectSchema;
use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Deserialize, JsonSchema)]
struct Summary {
    title: String,
    risks: Vec<String>,
}

let client = Client::from_env()?;
let summary: Summary = client
    .object(
        "ag_0123456789abcdef",
        "Summarize the release plan.",
        ObjectSchema::derive(),
    )
    .await?;
println!("{}: {} risks", summary.title, summary.risks.len());
```

A finished generation whose text is not the requested object fails with `Error::Object`; its `kind()` is `Truncated`, `InvalidJson`, or `Mismatch` and `text()` holds the complete generated text. See [Get structured output](recipes/structured-output.md) for streaming and failure handling.

### Stream ownership

Every chat, completion, and object stream has exactly one reader, by ownership. Reading to the end closes it; dropping it closes the connection and aborts running function handlers. A stream's timeout covers only the wait for headers, so a long reply can read for as long as it takes.

## Agent-scoped resources

`client.agent(agent_id)` returns a scoped handle without a network request. Its only member is `skills()`, so every Skill operation goes through `client.agent(agent_id).skills()`.

```rust
use blazing_agents::Client;
use futures_util::TryStreamExt;

let client = Client::from_env()?;
let agent_handle = client.agent("ag_0123456789abcdef");
let skills = agent_handle.skills();
let mut items = skills.list().items();
while let Some(skill) = items.try_next().await? {
    println!("{} {}", skill.id, skill.name);
}
```

## End-user scope

`client.for_user(user_id)` returns a `Result<UserClient, ConfigError>` without a network request. Every request it makes sends `X-BA-User-Id`, and the API limits reads and writes to resources that user owns. The header wins over `default_header` and `with_header`.

```rust
use blazing_agents::agents::Agent;
use blazing_agents::pagination::Page;
use blazing_agents::Client;

async fn list_my_agents(
    tenant_client: &Client,
    verified_user_id: &str,
) -> blazing_agents::Result<Page<Agent>> {
    tenant_client
        .for_user(verified_user_id)?
        .agents()
        .list()
        .limit(50)
        .await
}
```

- Take the ID from the session your backend verified, never from a request body or query parameter.
- The ID is 1 to 256 printable ASCII characters with no leading or trailing space. Anything else fails with `ConfigError::InvalidUserId`.
- A `UserClient` has `agents()`, `artifacts()`, `memories()`, `prompts()`, `sessions()`, `tasks()`, `workspaces()`, `agent()`, the generation methods, and `usage()` with only `get()` and `sessions()`. Tenant administration (`providers()`, `mcp_connections()`, `chat_connections()`, `chat_deliveries()`, `tenant()`, the merchant resources) and `usage().overview()` / `usage().get_for_agent()` exist only on the tenant client; the compiler rejects them on a `UserClient`.
- `with_client_request_id()` on a `UserClient` keeps the scope.

## Operation map

Required inputs are arguments; optional inputs are setters on the returned `Call`, shown after `->`. Every call also takes `with_header`, `with_client_request_id`, `with_timeout`, and `without_timeout`. `Page<T>` means the result is `{ data, next_cursor }` (see [Pagination](#pagination)).

### `client`

| Method | Returns |
| --- | --- |
| `chat(agent_id, input)`, `.session(...)`, `.user_id(...)`, `.metadata(...)`, `.functions(...)` | `ChatStream` |
| `regenerate(agent_id, session_id, input)`, `.message_id(...)`, `.user_id(...)`, `.metadata(...)`, `.functions(...)` | `ChatStream` |
| `continue_chat(agent_id, session_id, decisions)`, `.functions(...)` | `ChatStream` |
| `completion(agent_id, prompt)` / `completion_stream(agent_id, prompt)`, `.user_id(...)`, `.metadata(...)` | `String` / `CompletionStream` |
| `object::<T>(agent_id, prompt, schema)` / `object_stream::<T>(agent_id, prompt, schema)`, `.user_id(...)`, `.metadata(...)` | `T` / `ObjectStream<T>` |
| `agent(agent_id)` | `AgentHandle` (`skills()`) |
| `for_user(user_id)` | `UserClient` for one authenticated user |
| `with_client_request_id(id)` | The same client, tagging every call |

### `client.agents()`

| Method | Returns |
| --- | --- |
| `create(name)`, `.model(provider_id, model)`, `.thinking_level(...)`, `.workspace_id(...)`, `.workspace_tier(...)`, `.auto_compaction(...)`, `.compaction_reserve_tokens(...)`, `.memory_injection_enabled(...)`, `.tools(...)`, `.approval_in_chat(...)`, `.approval_in_tasks(...)`, `.instructions(...)`, `.user_id(...)`, `.metadata(...)`, `.mcp_connection_ids(...)` | `Agent` |
| `list()`, `.user_id(...)`, `.workspace_id(...)`, `.limit(...)` | `Page<Agent>` |
| `get(agent_id)` | `Agent` |
| `update(agent_id)`, `.name(...)`, `.model(provider_id, model)`, `.model_on_current_provider(model)`, `.clear_model()`, `.thinking_level(...)`, `.clear_thinking_level()`, `.workspace_id(...)`, `.auto_compaction(...)`, `.compaction_reserve_tokens(...)`, `.memory_injection_enabled(...)`, `.tools(...)`, `.approval_in_chat(...)`, `.approval_in_tasks(...)`, `.instructions(...)`, `.metadata(...)`, `.mcp_connection_ids(...)` | `Agent` |
| `delete(agent_id, include_artifacts: bool)` | `()`. The Workspace is kept |
| `disable(agent_id)` / `enable(agent_id)` | `Agent` |
| `upload_avatar(agent_id, Upload)` | `Agent`. A PNG, JPEG or WebP of 512 KiB or less |
| `remove_avatar(agent_id)` | `Agent` |
| `list_mcp_attachments(agent_id)` | `McpAttachmentList` |
| `update_mcp_attachment(agent_id, mcp_connection_id)`, `.forward_user_id(...)`, `.forwarded_metadata_keys(...)` | `McpAttachment` |
| `get_spending_limit(agent_id)` / `update_spending_limit(agent_id, Option<SpendingLimitInput>)` | `SpendingLimitStatus`. `None` disables the limit. See [model spending limits](recipes/usage-dashboards.md#model-spending-limits) |

`.model(provider_id, model)` sets both together on create. On update, `.model_on_current_provider(model)` changes only the model and `.model(provider_id, model)` changes Provider and model. `tools` is `AgentTool` values, each listed once, such as `AgentTool::Read`, `AgentTool::WriteTodos`, `AgentTool::SaveMemory`, or `AgentTool::WebSearch`. `agents::AGENT_TOOLS` lists each tool with `description`, `requires_workspace`, and `tags`, and `agents::AGENT_TOOL_GROUPS` names each group tag; filter on `tool.tags.contains(&AgentToolTag::FileRead)` for the read-only file tools. See [Built-in tools](concepts.md#built-in-tools).

### `client.agent(agent_id).skills()`

| Method | Returns |
| --- | --- |
| `create(path, content)` | `SkillDetail` (`path` must be `"SKILL.md"`; `content` starts with YAML frontmatter that sets `name` and `description`) |
| `upload(ArchiveType, Upload)` | `SkillDetail` (`ArchiveType::Zip`, `Tar`, `TarGz`) |
| `list()`, `.limit(...)` | `Page<Skill>` |
| `get(skill_id)` | `SkillDetail` |
| `delete(skill_id)` | `()` |
| `read_file(skill_id, path)` | `Download`, a streamed `Stream<Item = Result<Bytes>>` |
| `replace_file(skill_id, path, Upload)` | `SkillDetail` |
| `delete_file(skill_id, path)` | `SkillDetail` |
| `copy(skill_id, agent_ids)` | `Vec<SkillCopyResult>`, one per destination, in request order |

An `Upload` comes from `Upload::bytes(...)`, `Upload::file(path).await`, or `Upload::stream(...)`, with `.file_name(...)` and `.content_type(...)`.

### `client.sessions()`

| Method | Returns |
| --- | --- |
| `list(agent_id)`, `.user_id(...)`, `.limit(...)` | `Page<Session>` |
| `list_latest()`, `.user_id(...)`, `.by_agent(true)`, `.limit(...)` | `Page<LatestSession>` (`.by_agent(true)` gives at most one session per agent: its latest, for an inbox view) |
| `get(agent_id, session_id)` | `SessionDetail` (`agent_config`, `forked_from`) |
| `fork(agent_id, session_id, message_id, idempotency_key)` | `SessionDetail` for the child |
| `messages(agent_id, session_id)`, `.cursor(...)`, `.after(cursor)`, `.limit(...)` | `MessagesPage` (`data`, `next_cursor`, `latest_cursor`) |
| `tool_approvals(agent_id, session_id)` | `ToolApprovalList` (`data` of `ToolApproval`, `continuation`) |
| `submit_input(agent_id, session_id, request_id, message)` | `SubmittedInput` (`input`, the `SessionInput` receipt, plus `activity`). Steers the running Turn; fails `steer_not_available` when no Turn can take it |
| `inputs(agent_id, session_id)`, `.include_completed(true)`, `.limit(...)` | `InputsPage` (`data`, `next_cursor`, `activity`) |
| `stop(agent_id, session_id, turn_id)` | `StoppedTurn` (`stopped_turn_id`, `activity`) as soon as the stop is recorded; keep reading the existing stream until the Turn settles |
| `delete(agent_id, session_id, delete_artifacts: bool)` | `()` |

`fork()` sends `idempotency_key` as a header and fails client-side on an empty or non-header-safe key. Reuse the original key after a lost response; a retry returns the same child. The child's `forked_from` names the source Session and message. Fork eligibility, retries, and error codes are in [Add a requested fork](recipes/chat-in-your-app.md#add-a-requested-fork).

`messages()` returns the newest page in chronological order; pass `next_cursor` back as `.cursor(...)` for earlier pages, and save `latest_cursor` to pass as `.after(...)` later for messages that arrived since (never `cursor` and `after` together). While a Turn runs, `chat()` fails with `session_busy`; steer with `submit_input()` or hold the message in your own client. A Turn that stopped responding fails `session_turn_unresponsive`; wait out the error's `retry_after()`, read history, then send again under a new message ID.

`submit_input()` saves a steer receipt under your `request_id` before returning, so retry with the same `request_id` and message; a changed payload fails `input_idempotency_conflict`. Receipt `state` is `accepted`, `delivered`, `committed` (in history), `not_placed` (never ran, safe to resend as chat), or `uncertain` (may have run; never resend automatically). `inputs()` lists receipts; `.include_completed(true)` adds terminal ones, and `activity` (`idle`, `running`, `stopping`, `approval` with `turn_id`) says what the Session is doing. `stop()` takes `stream.turn_id()` in the client that started the Turn, or `activity.turn_id` read from `inputs()`. What each receipt state means and how the client-held queue works are in [Add chat to your app](recipes/chat-in-your-app.md#how-it-works).

### `client.tasks()`

| Method | Returns |
| --- | --- |
| `create(agent_id, name, prompt)`, `.idempotency_key(...)`, `.schedule(...)`, `.enabled(...)`, `.submit(...)`, `.user_id(...)`, `.metadata(...)` | `CreatedTask` (`task`, `run_id`). A retry with the same key returns the same Task and initial run |
| `list()`, `.agent_id(...)`, `.user_id(...)`, `.limit(...)` | `Page<TaskListItem>` |
| `get(task_id)` | `Task` |
| `update(task_id)`, `.name(...)`, `.prompt(...)`, `.schedule(...)`, `.clear_schedule()`, `.enabled(...)`, `.metadata(...)` | `Task` |
| `delete(task_id)` | `()`. A queued or running run blocks it |
| `submit(task_id)`, `.idempotency_key(...)` | `CreatedTaskRun` |
| `list_runs(task_id)`, `.limit(...)` | `Page<TaskRun>` |
| `get_run(task_id, run_id)` | `TaskRun` with `agent_config` saved when queued |
| `run_messages(task_id, run_id)`, `.after(cursor)`, `.limit(...)` | `RunMessagesPage` (`data`, `next_cursor`, `latest_cursor`, `status`, `error`, `finished_at`) |
| `cancel_run(task_id, run_id)` | `()` |

`schedule` is `Schedule::once(timestamp)`, `Schedule::interval(every_ms)` (at least 60000), or `Schedule::cron("0 9 * * 1")` with `.timezone("Pacific/Auckland")` and `.stagger_ms(...)`. `.clear_schedule()` on update removes it. Transcript pages walk backward with `.cursor(...)`; pass `latest_cursor` as `.after(...)` to poll for newer messages; never both.

### `client.workspaces()`

`create()` takes `.tier(workspaces::WorkspaceTier::Core)` (default) or `workspaces::WorkspaceTier::Plus`; `update` cannot change it. `agents().create().workspace_tier(...)` sets the tier of the new Workspace it creates and is rejected together with `.workspace_id(...)`, even as `Core`. See [Workspace](concepts.md#workspace) for choosing a tier.

| Method | Returns |
| --- | --- |
| `create()`, `.tier(...)`, `.name(...)`, `.user_id(...)`, `.metadata(...)`, `.network_policy(...)` | `Workspace` |
| `list()`, `.user_id(...)`, `.limit(...)` | `Page<Workspace>` |
| `get(workspace_id)` | `Workspace` |
| `update(workspace_id)`, `.name(...)`, `.clear_name()`, `.metadata(...)`, `.network_policy(...)` | `Workspace` |
| `delete(workspace_id)` | `WorkspaceDeletion` (`Completed` when it is gone, `Pending` while cleanup continues in the background) |

A network policy is `NetworkPolicy::Unrestricted`, `NetworkPolicy::allowlist(hosts)`, or `NetworkPolicy::Offline`.

### `client.providers()`

| Method | Returns |
| --- | --- |
| `create(name, ProviderType, api_key)`, `.base_url(...)` | `Provider`. The key is never returned |
| `list()` | `ProviderList` (`.providers`) |
| `get(provider_id)` | `Provider` |
| `update(provider_id, name)` | `Provider` |
| `delete(provider_id)`, `.confirm_snapshot_invalidation(true)` | `()` |
| `list_models(provider_id)` | `ProviderModelList` (`.models`) |
| `get_thinking_levels(provider_id, model)` | `ProviderThinkingLevels` |

`ProviderType` is `OpenAi`, `Anthropic`, `OpenRouter`, `Google`, `VercelAiGateway`, or `Custom` (needs `.base_url(...)`).

### `client.mcp_connections()`

| Method | Returns |
| --- | --- |
| `create(NewMcpConnection)` | `McpConnection`. Secrets are never returned |
| `list()` | `McpConnectionList` (`.mcp_connections`) |
| `get(mcp_connection_id)` | `McpConnection` |
| `update(mcp_connection_id, name)` | `McpConnection` |
| `delete(mcp_connection_id)` | `()` |
| `test(mcp_connection_id)` | `McpConnectionTest` (`Passed { server, tool_names, ... }` or `Failed { error }`) |
| `reconnect(mcp_connection_id, McpReconnect)` | `McpConnectionReconnectResult` (`status`, `connection`) |

`NewMcpConnection` has one struct variant per auth type (`None`, `Bearer`, `OAuthAuthorizationCode`, `OAuthClientCredentials`) with only the fields that auth type takes; `McpReconnect` is the same set for reconnecting. Attach a connection to an Agent through `agents().create()` / `update()` `.mcp_connection_ids(...)`. OAuth sign-in for an `oauth_authorization_code` connection happens in the dashboard: a Tenant administrator opens MCP connections, clicks **Connect**, and signs in to the server. The connection stays `needs_auth` until then, and an API key cannot start this sign-in.

### `client.memories()`

| Method | Returns |
| --- | --- |
| `create(agent_id, text)`, `.user_id(...)` | `Memory` |
| `list(agent_id)`, `.user_id(...)`, `.search(...)`, `.limit(...)` | `Page<Memory>` |
| `get(agent_id, memory_id)` | `Memory` |
| `update(agent_id, memory_id, text)` | `Memory` |
| `delete(agent_id, memory_id)` | `()` |

A `Memory` carries `id`, `user_id` (empty for a general memory), `text`, and timestamps including `last_accessed_at`; `get` does not touch `last_accessed_at`, `update` does. An agent holds at most 500 memories.

### `client.prompts()`

| Method | Returns |
| --- | --- |
| `create(name, template)`, `.agent_id(...)`, `.user_id(...)`, `.metadata(...)` | `Prompt` |
| `list()`, `.agent_id(...)`, `.user_id(...)`, `.limit(...)` | `Page<Prompt>` |
| `get(prompt_id)` | `Prompt` |
| `update(prompt_id)`, `.agent_id(...)`, `.clear_agent_id()`, `.name(...)`, `.template(...)`, `.metadata(...)` | `Prompt` |
| `delete(prompt_id)` | `()` |

Run a saved Prompt with `client.chat(agent_id, SavedPrompt::new(prompt_id).var("name", "value"))` or the other generation methods.

### `client.artifacts()`

| Method | Returns |
| --- | --- |
| `list()`, `.agent_id(...)`, `.session_id(...)` | `Page<Artifact>`. The server returns 50 Artifacts per page; follow `next_cursor` or use `.items()` |
| `get(artifact_id)` | `Artifact` |
| `create_download_url(artifact_id)` | `ArtifactDownloadUrl` (`url`, `expires_at`; the link works for five minutes without an API key) |
| `delete(artifact_id)` | `()` |

### `client.chat_connections()`

| Method | Returns |
| --- | --- |
| `create(NewChatConnection::slack(agent_id, name, SlackCredentials::new(bot_token, signing_secret))` or `::telegram(agent_id, name, TelegramCredentials::new(bot_token)))` | `ChatConnection`. Credentials are never returned |
| `list()` | `ChatConnectionList` (`.chat_connections`) |
| `get(chat_connection_id)` | `ChatConnection` |
| `update(chat_connection_id)`, `.name(...)`, `.channel_ids(...)`, `.chat_ids(...)`, `.business_mode(...)` | `ChatConnection` |
| `rotate_credentials(chat_connection_id, ChatCredentials::slack(...)` or `::telegram(...))` | `ChatConnection` |
| `check_health(chat_connection_id)` | `ChatConnection` |
| `enable(chat_connection_id)` / `disable(chat_connection_id)` | `ChatConnection` |
| `delete(chat_connection_id)` | `()` |
| `deliveries(chat_connection_id)`, `.limit(...)` | `Page<ChatDelivery>` |
| `repair_delivery(chat_connection_id, delivery_id, expected_attempt)` | `ChatDeliveryResult` |

`repair_delivery` confirms the previous sender has stopped and accepts that the repaired reply may post twice. `NewSlackConnection` and `NewTelegramConnection` also take `.enabled(...)`, `.channel_ids(...)`, `.chat_ids(...)`, and `.business_mode(...)` where they apply. See [Put your agent in Slack or Telegram](recipes/slack-and-telegram.md).

### `client.chat_deliveries()`

| Method | Returns |
| --- | --- |
| `list()`, `.status(...)`, `.since(...)`, `.limit(...)` | `Page<TenantChatDelivery>` |

Failed and ambiguous deliveries across every connection, newest first (an attention feed, not full history). `.status()` takes `ChatDeliveryListStatus::Failed` and/or `Ambiguous` (default both); pending and confirmed are rejected. `since` is an inclusive `Timestamp` lower bound.

### `client.usage()` and `client.tenant()`

| Method | Returns |
| --- | --- |
| `usage().overview()`, `.range(from, to)`, `.limit(...)` | `UsageOverview` (totals, daily rows, top breakdowns) |
| `usage().get()`, `.range(from, to)`, `.agent_id(...)`, `.session_id(...)`, `.user_id(...)`, `.group_by(...)`, `.limit(...)` | `Usage` |
| `usage().get_for_agent(agent_id)`, `.range(from, to)`, `.session_id(...)`, `.user_id(...)`, `.group_by(...)`, `.limit(...)` | `Usage` |
| `usage().sessions(session_ids)`, `.range(from, to)` | `SessionUsage` (`data`: one `SessionUsageEntry` per ID; 1 to 100 IDs) |
| `tenant().get()` | `TenantSettings` |
| `tenant().update()`, `.name(...)`, `.monetization_enabled(...)`, `.quota(QuotaInput)`, `.clear_quota()` | `TenantSettings`. Turning `monetization_enabled` off drops usage events the merchant has not accepted |
| `tenant().get_spending_limit()` / `tenant().update_spending_limit(Option<SpendingLimitInput>)` | `SpendingLimitStatus` |

`group_by` is `UsageGroupBy::Day`, `Agent`, `Model`, `Session`, or `User`. `range(from, to)` takes `YYYY-MM-DD` dates. `QuotaInput::new(reset_day)` sets the reset day and takes `.monthly_token_limit(...)` and `.monthly_request_limit(...)`; a limit you do not set goes out as `null`, which means unlimited.

### `client.merchant_connection()`, `client.merchant_bindings()`, `client.merchant_usage_events()`

Monetization: bill your end users through your own Polar or Dodo account. Setup, guard rules, and delivery states are in [Usage dashboards](recipes/usage-dashboards.md).

| Method | Returns |
| --- | --- |
| `merchant_connection().get()` | `Option<MerchantConnection>` |
| `merchant_connection().create(MerchantProvider, MerchantEnvironment, credential)`, `.guard(...)` | `MerchantConnection`. `MerchantProvider::Polar` or `Dodo`; `MerchantEnvironment::Sandbox` or `Live` |
| `merchant_connection().update()`, `.credential(...)`, `.status(...)`, `.guard(...)` | `MerchantConnection` |
| `merchant_connection().retire()` | `()`. Stops deliveries |
| `merchant_bindings().list()`, `.user_id(...)`, `.limit(...)` | `BindingsPage`. Fails `merchant_connection_not_found` when there is no connection |
| `merchant_bindings().set(user_id, customer_id)` | `MerchantBinding`. The API checks the customer exists at the provider |
| `merchant_bindings().delete(user_id)` | `()` |
| `merchant_usage_events().list()`, `.status(...)`, `.limit(...)` | `UsageEventsPage` |
| `merchant_usage_events().get(event_id)` | `MerchantUsageEvent` (`next_action` says what to do) |
| `merchant_usage_events().summary()`, `.days(...)` | `MerchantUsageSummary` (status counts and a daily window; `days` 1 to 90, default 14) |
| `merchant_usage_events().retry(event_id)` / `release(event_id)` / `discard(event_id)` | `MerchantUsageEvent` |

`guard` is `MerchantGuard::new(enabled)` with `.product_ids(...)` and `.meter_id(...)`. Turn billing on with `tenant().update().monetization_enabled(true)` after the connection exists.

## Partial updates: unset keeps, `clear_*` sends null

A setter you never call is not sent, so the server keeps the current value (or its default on create). A nullable field has a `clear_*` setter (`clear_model()`, `clear_thinking_level()`, `clear_agent_id()`, `clear_name()`, `clear_schedule()`, `clear_quota()`) that sends JSON `null` and clears it.

```rust
use blazing_agents::Client;

let client = Client::from_env()?;
// Changes only the instructions. Every other field keeps its value.
client
    .agents()
    .update("ag_0123456789abcdef")
    .instructions("Answer in two sentences.")
    .await?;
// Sends null: back to the Provider's default thinking level.
client
    .agents()
    .update("ag_0123456789abcdef")
    .clear_thinking_level()
    .await?;
```

- Supplied lists and maps replace the old value completely. `tools`, `mcp_connection_ids`, `metadata`, and approval policies are not merged.
- `update_spending_limit(id, None)` removes a spending limit.
- To forward optional values from your own input, chain each setter conditionally; there is no catch-all map.

## Pagination

A paginated list call returns one `Page` (`data`, `next_cursor`; `None` on the last page) when awaited. `.pages()` and `.items()` walk every page lazily and send nothing before the first poll; `.cursor(cursor)` resumes from a saved `Cursor`.

```rust
use blazing_agents::Client;
use futures_util::TryStreamExt;

let client = Client::from_env()?;
let mut sessions = client.sessions().list("ag_0123456789abcdef").items();
while let Some(session) = sessions.try_next().await? {
    println!("{} {}", session.id, session.message_count);
}

let mut cursor = None;
loop {
    let mut call = client.tasks().list().limit(20);
    if let Some(cursor) = cursor {
        call = call.cursor(cursor);
    }
    let page = call.await?;
    for task in &page.data {
        println!("{} {}", task.id, task.name);
    }
    match page.next_cursor {
        Some(next) => cursor = Some(next),
        None => break,
    }
}
```

`providers().list()`, `mcp_connections().list()`, and `chat_connections().list()` return every item in one response. `tasks().run_messages()` also returns `latest_cursor`; pass it as `.after(...)` later to fetch only newer messages. Do not send `cursor` and `after` together.

For server-enforced end-user scope, use [`client.for_user(verified_user_id)`](#end-user-scope). A `user_id` setter alone is Attribution.

## Errors

Every failure a call can produce is the `blazing_agents::Error` enum.

| Variant | Raised when | Useful accessors |
| --- | --- | --- |
| `Error::Api(ApiError)` | The API returns an error status | `status()`, `code()`, `message()`, `details()`, `param()`, `request_id()`, `retry_after()`, `headers()`, `body()` |
| `Error::Connection` | The network fails before a complete response | |
| `Error::Timeout` | The call's timeout elapsed | |
| `Error::Stream(StreamError)` | A stream fails after headers arrive or ends early | `kind()` (`StreamErrorKind`), `meta()` |
| `Error::Object(ObjectError)` | Structured output is truncated, invalid, or mismatched | `kind()` (`ObjectErrorKind`), `text()`, `meta()` |
| `Error::Decode` | A 2xx body does not match the response model | `operation_id`, `request_id` |
| `Error::CredentialEcho` | A response echoed credential material back | `operation_id`, `request_id` |
| `Error::InvalidArgument` | A client-side argument the types could not rule out | |
| `Error::Config(ConfigError)` | A client configuration problem, before any request | |

`Error::status()`, `request_id()`, and `code()` work across variants. `code()` returns `Option<&ErrorCode>`, an open enum: a code this version does not know is `ErrorCode::Unrecognized`, so match with a fallback arm. Branch on the code, not the message.

```rust
use blazing_agents::error::ErrorCode;
use blazing_agents::{Client, Error};

let client = Client::from_env()?;
match client.agents().get("ag_0123456789abcdef").await {
    Ok(agent) => println!("{}", agent.name),
    Err(Error::Api(error)) => {
        // Branch on the stable code, not the message.
        if error.code() == &ErrorCode::NotFound {
            println!("No such Agent");
        } else {
            println!(
                "{} {} {:?} {:?}",
                error.status(),
                error.code(),
                error.request_id(),
                error.retry_after()
            );
        }
    }
    Err(Error::Stream(error)) => println!("Stream failed {:?}", error.meta().request_id()),
    Err(Error::Connection(_) | Error::Timeout) => {
        println!("Could not reach Blazing Agents")
    }
    Err(error) => return Err(error.into()),
}
```

`send_with_meta()` returns a `WithMeta` whose `meta` carries the response `status()`, `headers()`, and server `request_id()`. Streams expose the same through `.meta()`. Include the request ID when you contact support.

## Gotchas

- Chat on a busy Session fails `session_busy`. Steer the running Turn with `sessions().submit_input()`, or keep the message in your own queue and send it as ordinary chat once the Turn settles. A Turn that stopped responding fails `session_turn_unresponsive` with `Retry-After`; wait it out, read history, then send again under a new message ID.
- Reading a `ChatStream` into memory before replying breaks streaming for your user. Turn the stream into your framework's streaming body.
- Losing `stream.session_id()` starts a fresh Session on every message. Save it with your user before you return the response.
- `for_user` returns a `Result`: handle `ConfigError::InvalidUserId` instead of unwrapping an ID taken from a request.
- Agent and Prompt names can repeat. Read every page before resolving a name to an ID; reject multiple exact matches.
- `delete(agent_id, include_artifacts)` and `sessions().delete(agent_id, session_id, delete_artifacts)` take the flag as an argument. Decide explicitly whether published files go too.
- Response models are `#[non_exhaustive]` structs; construct nothing yourself and match enums with a fallback arm for `Unrecognized`.

## Go deeper

- [Rust SDK repository](https://github.com/blazingagents/rust-sdk)
- [Error codes](https://docs.blazingagents.com/api-reference/protocols/errors)
- [Connect Blazing Agents to your app](https://docs.blazingagents.com/getting-started/connect-your-app)
- [Add chat to your app](recipes/chat-in-your-app.md) for a full axum relay endpoint
