# Get started with Blazing Agents: Python code

The Python code for the steps of [Get started with Blazing Agents](getting-started.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 2: Check the connection

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()  # reads BLAZING_AGENTS_API_KEY
page = client.agents.list()
print(f"Connected. First page has {len(page.data)} agents.")
```

## Step 3: Create the Provider and Agent, then stream a first reply

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
