# Give your agent your own tools through MCP: Rust code

The Rust code for the steps of [Give your agent your own tools through MCP](external-tools-mcp.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Create the Connection once, on your backend

```rust
use blazing_agents::mcp_connections::NewMcpConnection;

let connection = client
    .mcp_connections()
    .create(NewMcpConnection::Bearer {
        name: "Customer tools".to_owned(),
        url: "https://mcp.example.com/v1".to_owned(),
        bearer_token: std::env::var("CUSTOMER_MCP_TOKEN")?,
    })
    .await?;
println!("{} {:?}", connection.id, connection.status);
```

## Step 3: Test the Connection, attach it to the Agent, and choose what end-user context the server receives

```rust
use blazing_agents::mcp_connections::McpConnectionTest;

let agent_id = "ag_0123456789abcdef";
let mcp_connection_id = "mcp_0123456789abcdef";

let test = client.mcp_connections().test(mcp_connection_id).await?;
let tool_names = match &test {
    McpConnectionTest::Passed { tool_names, .. } => tool_names,
    McpConnectionTest::Failed { error } => {
        return Err(format!("{}: {}", error.code, error.message).into());
    }
    _ => unreachable!(),
};
if !tool_names.iter().any(|name| name == "lookup_customer") {
    return Err(format!("Expected lookup_customer, got {tool_names:?}").into());
}

let agent = client.agents().get(agent_id).await?;
if !agent
    .mcp_connection_ids
    .iter()
    .any(|id| id.as_str() == mcp_connection_id)
{
    let mut ids = agent.mcp_connection_ids;
    ids.push(mcp_connection_id.into());
    client
        .agents()
        .update(agent_id)
        .mcp_connection_ids(ids)
        .await?;
}

client
    .agents()
    .update_mcp_attachment(agent_id, mcp_connection_id)
    .forward_user_id(true)
    .forwarded_metadata_keys(["plan"])
    .await?;
```

## Step 4: Run a Turn that needs the tool, then read the saved Session to confirm the call

```rust
use blazing_agents::messages::UserMessage;
use blazing_agents::types::Metadata;
use futures_util::TryStreamExt;

let client = client.for_user("user_123")?; // the verified signed-in user
let mut stream = client
    .chat(
        "ag_0123456789abcdef",
        UserMessage::text("Look up customer 42 and summarize their account."),
    )
    .metadata(Metadata::new().insert("plan", "pro"))
    .await?;
let session_id = stream.session_id().clone();
while stream.try_next().await?.is_some() {
    // Drain the stream; in an app, relay the raw bytes to the browser instead.
}

let page = client
    .sessions()
    .messages("ag_0123456789abcdef", &session_id)
    .await?;
let called = page
    .data
    .iter()
    .any(|m| m.parts.iter().any(|part| part.kind.contains("lookup_customer")));
println!(
    "{session_id} {}",
    if called { "MCP tool was called" } else { "MCP tool was not called" }
);
```
