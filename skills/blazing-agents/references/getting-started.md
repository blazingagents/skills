# Get started with Blazing Agents

By the end of this page, one small backend program creates a Provider and an Agent and streams the Agent's first reply. The next step is putting that reply inside your app.

## When to use this

Use this page when you have no Blazing Agents (BA) code yet and want to see an Agent answer. If you already have an Agent and want chat in your product, read [Add chat to your app](recipes/chat-in-your-app.md).

## How it works

Your backend talks to BA through the TypeScript or Python SDK, authenticated with a Tenant API key. A Provider stores your model account key (here, OpenRouter) once, so later calls never resend it. An Agent pairs a Provider with a model and is reused on every call. `chat()` sends one user message and streams the reply. With no `sessionId`, BA starts a new Session and keeps its history for you. The stream uses the AI SDK UI message format, so a web app can hand it straight to `useChat`.

## What you need

- A BA account and a Tenant API key. Create it in the dashboard at [API keys](https://www.blazingagents.com/app/keys) and copy the full `ba_...` value. It is shown only once.
- A backend on Node.js 24+ or Python 3.11+. The SDK runs on the server only.
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
npm install @blazingagents/sdk ai
```

```bash
pip install blazing-agents
```

2. Check the connection. This lists the Agents in your Tenant and changes nothing. A new Tenant already has 1 Agent, its admin Agent.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
if (!apiKey) throw new Error("Set BLAZING_AGENTS_API_KEY");

const client = new BlazingAgents({ apiKey });
const { agents } = await client.agents.list();
console.log(`Connected. Your tenant has ${agents.length} agents.`);
```

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()  # reads BLAZING_AGENTS_API_KEY
agents = client.agents.list().agents
print(f"Connected. Your tenant has {len(agents)} agents.")
```

3. Create the Provider and Agent, then stream a first reply. The program looks both up by name, so it is safe to run again.

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
const { agents } = await client.agents.list();
const agent =
  agents.find(({ name }) => name === agentName) ??
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
agents = client.agents.list().agents
agent = next((a for a in agents if a.name == agent_name), None) or client.agents.create(
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

4. Hand off to your app. In a web backend, return `result.toResponse()` (TypeScript) or the stream in a streaming response (Python) instead of printing it, and save the Session ID so the next message continues the conversation. [Add chat to your app](recipes/chat-in-your-app.md) walks through the endpoint, sign-in, Session ownership, and the `useChat` UI.

## Gotchas

- The Tenant API key reaches every Agent in the Tenant. Keep it in backend configuration. Browser and mobile code call your backend, never BA.
- `providers.create` stores the OpenRouter key without checking it. A bad key surfaces at `agents.create` as `model_validation_unavailable` (503). The same code can mean OpenRouter was briefly unreachable, so retry once after a short wait. If it persists, fix the key, delete the Provider (`client.providers.delete({ providerId })` or `client.providers.delete(provider_id)`), and run again.
- `model_not_found` at `agents.create` means the model ID is not offered by that Provider. List valid IDs with `client.providers.listModels({ providerId })` or `client.providers.list_models(provider_id=...)`.
- Each `chat()` without a Session ID starts a new Session with no memory of earlier calls. Pass `sessionId` (`session_id` in Python) to continue one.
- In Python, use the stream inside `with` so the connection closes when you are done.
- The stream is server-sent events. Relay it or pass it to AI SDK tooling rather than splitting frames yourself.

## Check it works

- Step 2 prints `Connected. Your tenant has N agents.` An authentication error means the key is not exported in that shell or was copied incompletely.
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
