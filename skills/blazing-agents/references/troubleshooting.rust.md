# Troubleshoot a Blazing Agents integration: Rust code

The Rust code for the steps of [Troubleshoot a Blazing Agents integration](troubleshooting.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Read the error first

```rust
match client.agents().get("ag_0123456789abcdef").await {
    Ok(agent) => println!("{}", agent.name),
    Err(error) => {
        eprintln!(
            "{:?} {:?} {:?}",
            error.code(),
            error.status(),
            error.request_id()
        );
        return Err(error.into());
    }
}
```

## MCP authorization missing

```rust
use blazing_agents::mcp_connections::McpConnectionTest;

let connection = client
    .mcp_connections()
    .get("mcp_0123456789abcdef")
    .await?;
println!("{:?} {:?}", connection.status, connection.last_auth_error_code);
if let McpConnectionTest::Failed { error } = client
    .mcp_connections()
    .test("mcp_0123456789abcdef")
    .await?
{
    println!("{} {}", error.code, error.message);
}
```

## Chat Connection health unknown

```rust
use blazing_agents::chat_connections::ChatHealthCheckStatus;

let connection = client
    .chat_connections()
    .check_health("cc_0123456789abcdef")
    .await?;
println!("{} {}", connection.enabled, connection.health.token_valid);
for check in &connection.health.checks {
    if check.status != ChatHealthCheckStatus::Pass {
        println!("{} {:?} {:?}", check.code, check.status, check.subject);
    }
}
```
