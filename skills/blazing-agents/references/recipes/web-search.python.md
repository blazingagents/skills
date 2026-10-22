# Let an Agent search the web: Python code

The Python code for the steps of [Let an Agent search the web](web-search.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Create an Agent with `web_search`

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()  # reads BLAZING_AGENTS_API_KEY

agent = client.agents.create(
    name="Research assistant",
    provider_id="prv_0123456789abcdef",
    model="openai/gpt-6-luna",
    instructions=(
        "Search the web only for facts that may have changed recently. "
        "Use at most three searches per answer. "
        "List the URLs you relied on at the end."
    ),
    tools=["web_search"],
)
print(agent.id)
```

## Step 2: To add web search to an existing Agent, read its `tools` and send the whole list back with `web_search` added

```python
from blazing_agents import BlazingAgents


def enable_web_search(client: BlazingAgents, agent_id: str) -> None:
    agent = client.agents.get(agent_id)
    if "web_search" not in agent.tools:
        client.agents.update(agent_id, tools=[*agent.tools, "web_search"])
```
