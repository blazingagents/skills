# Get started with Blazing Agents

By the end of this page, one small backend program creates a Provider and an Agent and streams the Agent's first reply. The next step is putting that reply inside your app.

## When to use this

Use this page when you have no Blazing Agents (BA) code yet and want to see an Agent answer. If you already have an Agent and want chat in your product, read [Add chat to your app](recipes/chat-in-your-app.md).

## How it works

Your backend talks to BA through the TypeScript, Python, Rust, or Go SDK, authenticated with a Tenant API key. A Provider stores your model account key (here, OpenRouter) once, so later calls never resend it. An Agent pairs a Provider with a model and is reused on every call. `chat()` sends one user message and streams the reply. With no `sessionId`, BA starts a new Session and keeps its history for you. The stream uses the AI SDK UI message format, so a web app can hand it straight to `useChat`.

## What you need

- A BA account and a Tenant API key. Create it in the dashboard at [API keys](https://www.blazingagents.com/app/keys) and copy the full `ba_...` value. It is shown only once.
- A backend on Node.js 24+, Python 3.11+, Rust 1.85+ with Tokio, or Go 1.26+. The SDK runs on the server only.
- An OpenRouter API key.

```bash
export BLAZING_AGENTS_API_KEY="ba_..."
export OPENROUTER_API_KEY="sk-or-..."
```

One-off Tenant setup, such as creating the Provider and Agent, can also be done in the [dashboard](https://www.blazingagents.com/app/providers) or with the `ba-admin` skill. Do it in code, as below, when the app must create them itself or you want the setup checked in.

## Build it

1. Install the SDK. TypeScript needs the `ai` package next to it.

```bash
npm pkg set type=module
npm install @blazingagents/sdk ai@^7
```

```bash
pip install blazing-agents
```

```bash
cargo add blazing-agents
cargo add tokio --features macros,rt-multi-thread
```

```bash
go get github.com/blazingagents/golang-sdk@v0.3.0
```

2. Check the connection. This lists the first page of Agents in your Tenant and changes nothing. A new Tenant already has 1 Agent, its admin Agent.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
if (!apiKey) throw new Error("Set BLAZING_AGENTS_API_KEY");

const client = new BlazingAgents({ apiKey });
const page = await client.agents.list();
console.log(`Connected. First page has ${page.data.length} agents.`);
```

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()  # reads BLAZING_AGENTS_API_KEY
page = client.agents.list()
print(f"Connected. First page has {len(page.data)} agents.")
```

```rust
use blazing_agents::Client;

let client = Client::from_env()?; // reads BLAZING_AGENTS_API_KEY
let page = client.agents().list().await?;
println!("Connected. First page has {} agents.", page.data.len());
```

```go
page, err := client.Agents.List(ctx, ba.ListAgentsParams{})
if err != nil {
	return err
}
fmt.Printf("Connected. First page has %d agents.\n", len(page.Data))
```

3. Create the Provider and Agent, then stream a first reply. The program checks every Agent page and rejects duplicate name matches. Run setup once at a time and save the resulting IDs; concurrent setup or a lost create response still requires reconciliation.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
const openRouterKey = process.env.OPENROUTER_API_KEY;
if (!apiKey || !openRouterKey) {
  throw new Error("Set BLAZING_AGENTS_API_KEY and OPENROUTER_API_KEY");
}

const client = new BlazingAgents({ apiKey });

const providerName = "Quickstart OpenRouter";
const { providers } = await client.providers.list();
const provider =
  providers.find(({ name }) => name === providerName) ??
  (await client.providers.create({
    name: providerName,
    providerType: "openrouter",
    baseUrl: null,
    apiKey: openRouterKey,
  }));

const agentName = "Quickstart agent";
const matches = [];
let cursor: string | undefined;
do {
  const page = await client.agents.list({ cursor, limit: 100 });
  matches.push(...page.data.filter(({ name }) => name === agentName));
  cursor = page.nextCursor ?? undefined;
} while (cursor);
if (matches.length > 1) throw new Error("Multiple Agents match. Choose an ID.");
const agent =
  matches[0] ??
  (await client.agents.create({
    name: agentName,
    providerId: provider.id,
    model: "openai/gpt-6-luna",
  }));

const result = await client.chat({
  agentId: agent.id,
  message: {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text: "Say hello in one short sentence." }],
  },
});
console.log(`Session: ${await result.sessionId}`);

for await (const chunk of result.toStream()) {
  process.stdout.write(chunk);
}
// Raw AI SDK UI message stream: relay it, store it, or render it as you like.
```

```python
import os
import sys
import uuid

from blazing_agents import BlazingAgents

client = BlazingAgents()

provider_name = "Quickstart OpenRouter"
providers = client.providers.list().providers
provider = next(
    (p for p in providers if p.name == provider_name), None
) or client.providers.create(
    name=provider_name,
    provider_type="openrouter",
    base_url=None,
    api_key=os.environ["OPENROUTER_API_KEY"],
)

agent_name = "Quickstart agent"
page = client.agents.list(limit=100)
matches = [a for a in page.data if a.name == agent_name]
while page.next_cursor is not None:
    page = client.agents.list(limit=100, cursor=page.next_cursor)
    matches.extend(a for a in page.data if a.name == agent_name)
if len(matches) > 1:
    raise ValueError("Multiple Agents match. Choose an ID.")
agent = matches[0] if matches else client.agents.create(
    name=agent_name,
    provider_id=provider.id,
    model="openai/gpt-6-luna",
)

message = {
    "id": str(uuid.uuid4()),
    "role": "user",
    "parts": [{"type": "text", "text": "Say hello in one short sentence."}],
}
with client.chat(agent_id=agent.id, message=message) as stream:
    print(f"Session: {stream.session_id}")
    for chunk in stream:
        sys.stdout.buffer.write(chunk)
    # Raw AI SDK UI message stream: relay it, store it, or render it as you like.
```

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

```go
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	ba "github.com/blazingagents/golang-sdk"
)

func main() {
	ctx := context.Background()
	client, err := ba.NewClient() // reads BLAZING_AGENTS_API_KEY
	if err != nil {
		log.Fatal(err)
	}

	providerName := "Quickstart OpenRouter"
	providers, err := client.Providers.List(ctx)
	if err != nil {
		log.Fatal(err)
	}
	var providerID ba.ProviderID
	for _, provider := range providers {
		if provider.Name == providerName {
			providerID = provider.ID
		}
	}
	if providerID == "" {
		provider, err := client.Providers.Create(ctx, ba.CreateProviderParams{
			Name:         providerName,
			ProviderType: ba.ProviderTypeOpenRouter,
			APIKey:       ba.NewSecret(os.Getenv("OPENROUTER_API_KEY")),
		})
		if err != nil {
			log.Fatal(err)
		}
		providerID = provider.ID
	}

	agentName := "Quickstart agent"
	var matches []ba.Agent
	for agent, err := range client.Agents.All(ctx, ba.ListAgentsParams{Limit: new(100)}) {
		if err != nil {
			log.Fatal(err)
		}
		if agent.Name == agentName {
			matches = append(matches, agent)
		}
	}
	if len(matches) > 1 {
		log.Fatal("Multiple Agents match. Choose an ID.")
	}
	var agent *ba.Agent
	if len(matches) == 1 {
		agent = &matches[0]
	} else {
		agent, err = client.Agents.Create(ctx, ba.CreateAgentParams{
			Name:       agentName,
			ProviderID: ba.Value(providerID),
			Model:      ba.Value("openai/gpt-6-luna"),
		})
		if err != nil {
			log.Fatal(err)
		}
	}

	stream, err := client.Chat.Send(ctx, agent.ID,
		ba.Messages(ba.TextMessage("Say hello in one short sentence.")), ba.ChatParams{})
	if err != nil {
		log.Fatal(err)
	}
	defer stream.Close()
	fmt.Println("Session:", stream.SessionID())
	for event, err := range stream.Events() {
		if err != nil {
			log.Fatal(err)
		}
		os.Stdout.Write(event)
	}
	// Raw AI SDK UI message stream: relay it, store it, or render it as you like.
}
```

4. Hand off to your app. In a web backend, return `result.toResponse()` (TypeScript), the stream in a streaming response (Python), `Body::from_stream(stream)` in a Rust framework such as axum, or `stream.WriteTo(w)` in a Go `net/http` handler instead of printing it, and save the Session ID so the next message continues the conversation. [Add chat to your app](recipes/chat-in-your-app.md) walks through the endpoint, sign-in, user scope, and the `useChat` UI.

## Gotchas

- The Tenant API key reaches every Agent in the Tenant. Keep it in backend configuration. Browser and mobile code call your backend, never BA.
- `providers.create` stores the OpenRouter key without checking it. A bad key surfaces at `agents.create` as `model_validation_unavailable` (503). The same code can mean OpenRouter was briefly unreachable, so retry once after a short wait. If it persists, fix the key, delete the Provider (`client.providers.delete({ providerId })`, `client.providers.delete(provider_id)` in Python, `client.providers().delete(provider_id)` in Rust, `client.Providers.Delete(ctx, providerID, ba.DeleteProviderParams{})` in Go), and run again.
- `model_not_found` at `agents.create` means the model ID is not offered by that Provider. List valid IDs with `client.providers.listModels({ providerId })`, `client.providers.list_models(provider_id=...)` in Python, `client.providers().list_models(provider_id)` in Rust, or `client.Providers.ListModels(ctx, providerID)` in Go.
- Each `chat()` without a Session ID starts a new Session with no memory of earlier calls. Pass `sessionId` (`session_id` in Python, `.session(session_id)` on the call in Rust, `SessionID` in `ba.ChatParams` in Go) to continue one.
- In Python, use the stream inside `with` so the connection closes when you are done. In Rust, the stream closes when you read it to the end or drop it. In Go, `defer stream.Close()` right after the call.
- The stream is server-sent events. Relay it or pass it to AI SDK tooling rather than splitting frames yourself.

## Check it works

- Step 2 prints `Connected. First page has N agents.` An authentication error means the key is not exported in that shell or was copied incompletely.
- Step 3 prints `Session: ss_...` then `data: {...}` lines ending with `data: [DONE]`.
- Run step 3 again. The Provider and Agent IDs stay the same; the Session ID is new.
- The Provider and Agent appear in the dashboard.

## Go deeper

- [Set up Blazing Agents](https://docs.blazingagents.com/getting-started/setup)
- [Run your first agent](https://docs.blazingagents.com/getting-started/quickstart)
- [Connect Blazing Agents to your app](https://docs.blazingagents.com/getting-started/connect-your-app)
- [Providers and models](https://docs.blazingagents.com/agents/providers-and-models)
- [Sessions and turns](https://docs.blazingagents.com/platform/sessions-and-turns)
- [Errors](https://docs.blazingagents.com/api-reference/protocols/errors)
- [Example apps](https://github.com/blazingagents/examples)
