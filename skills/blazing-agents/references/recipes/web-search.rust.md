# Let an Agent search the web: Rust code

The Rust code for the steps of [Let an Agent search the web](web-search.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Create an Agent with `web_search`

```rust
use blazing_agents::agents::AgentTool;

let agent = client
    .agents()
    .create("Research assistant")
    .model("prv_0123456789abcdef", "openai/gpt-6-luna")
    .instructions(
        "Search the web only for facts that may have changed recently. \
         Use at most three searches per answer. \
         List the URLs you relied on at the end.",
    )
    .tools([AgentTool::WebSearch])
    .await?;
println!("{}", agent.id);
```

## Step 2: To add web search to an existing Agent, read its `tools` and send the whole list back with `web_search` added

```rust
use blazing_agents::agents::AgentTool;

let agent = client.agents().get("ag_0123456789abcdef").await?;
if !agent.tools.contains(&AgentTool::WebSearch) {
    let mut tools = agent.tools;
    tools.push(AgentTool::WebSearch);
    client
        .agents()
        .update("ag_0123456789abcdef")
        .tools(tools)
        .await?;
}
```
