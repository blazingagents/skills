# Get started with Blazing Agents: Rust code

The Rust code for the steps of [Get started with Blazing Agents](getting-started.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 2: Check the connection

```rust
use blazing_agents::Client;

let client = Client::from_env()?; // reads BLAZING_AGENTS_API_KEY
let page = client.agents().list().await?;
println!("Connected. First page has {} agents.", page.data.len());
```

## Step 3: Create the Provider and Agent, then stream a first reply

```rust
use blazing_agents::messages::UserMessage;
use blazing_agents::providers::ProviderType;
use blazing_agents::Client;
use futures_util::TryStreamExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let client = Client::from_env()?;
    let openrouter_key = std::env::var("OPENROUTER_API_KEY")?;

    let provider_name = "Quickstart OpenRouter";
    let provider_id = match client
        .providers()
        .list()
        .await?
        .providers
        .iter()
        .find(|provider| provider.name == provider_name)
    {
        Some(provider) => provider.id.clone(),
        None => {
            client
                .providers()
                .create(provider_name, ProviderType::OpenRouter, openrouter_key)
                .await?
                .id
        }
    };

    let agent_name = "Quickstart agent";
    let mut matches = Vec::new();
    let mut cursor = None;
    loop {
        let mut call = client.agents().list().limit(100);
        if let Some(cursor) = cursor {
            call = call.cursor(cursor);
        }
        let page = call.await?;
        matches.extend(page.data.into_iter().filter(|a| a.name == agent_name));
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    if matches.len() > 1 {
        return Err("Multiple Agents match. Choose an ID.".into());
    }
    let agent = match matches.into_iter().next() {
        Some(agent) => agent,
        None => {
            client
                .agents()
                .create(agent_name)
                .model(provider_id, "openai/gpt-6-luna")
                .await?
        }
    };

    let mut stream = client
        .chat(agent.id, UserMessage::text("Say hello in one short sentence."))
        .await?;
    println!("Session: {}", stream.session_id());
    while let Some(chunk) = stream.try_next().await? {
        print!("{}", String::from_utf8_lossy(&chunk));
    }
    // Raw AI SDK UI message stream: relay it, store it, or render it as you like.
    Ok(())
}
```
