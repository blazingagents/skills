# Let an Agent search the web

You will have an Agent that looks up current information on the public web with the built-in `web_search` tool and answers with the sources it used.

## When to use this

The Agent must answer questions about things that change: prices, releases, news, documentation, or anything newer than its model's training data. If the information lives in your own systems, connect them with [MCP](external-tools-mcp.md) or [backend functions](backend-functions.md) instead. If the Agent needs stable reference material, put it in a runtime Skill, as in [Shape agent behavior](shape-agent-behavior.md).

## How it works

`web_search` is off until you add it to the Agent's `tools`. When the model calls it, it sends a `query` (1 to 1,024 characters) and an optional `limit`. It gets back up to 10 results, which is also the default. Each result has a `url`, a `title`, and usually a `description` snippet. The tool returns no full page content, and when the results are too large it returns the ones that fit with `truncated: true`. A failed search returns an error message to the model instead of results. The call and its output are saved in the Session like any other tool call, as a `tool-web_search` part.

Each successful search consumes Usage credit. Failed searches are free. BA bills searches itself, so they consume credit even when the Agent runs on the Tenant's own model Provider, and model spending limits do not cap them.

The web search queries, not linked to an individual, might be kept for model training.

## Build it

1. Create an Agent with `web_search`. Tell it when to search and to cite what it used, because every search costs credit.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
if (!apiKey) throw new Error("Set BLAZING_AGENTS_API_KEY");
const client = new BlazingAgents({ apiKey });

const agent = await client.agents.create({
  name: "Research assistant",
  providerId: "prv_0123456789abcdef",
  model: "openai/gpt-6-luna",
  instructions:
    "Search the web only for facts that may have changed recently. Use at most three searches per answer. List the URLs you relied on at the end.",
  tools: ["web_search"],
});
console.log(agent.id);
```

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

2. To add web search to an existing Agent, read its `tools` and send the whole list back with `web_search` added. `tools` replaces the selection and rejects duplicate names.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const agentId: string;

const agent = await client.agents.get({ agentId });
const tools = new Set(agent.tools).add("web_search");
await client.agents.update({ agentId, tools: [...tools] });
```

```python
from blazing_agents import BlazingAgents


def enable_web_search(client: BlazingAgents, agent_id: str) -> None:
    agent = client.agents.get(agent_id)
    if "web_search" not in agent.tools:
        client.agents.update(agent_id, tools=[*agent.tools, "web_search"])
```

3. Chat with the Agent as usual, following [Add chat to your app](chat-in-your-app.md). Your UI renders the `tool-web_search` parts like any other tool call, so users can see what was searched.

## Gotchas

- The Agent answers from memory instead of searching. `web_search` is not in `tools`, or the instructions never say when to search. Check `agent.tools` and the instructions.
- Expecting page contents. Results hold only URLs, titles, and snippets. To read a page, the Agent needs another tool, such as an MCP server that fetches pages or `bash` with network access in its Workspace.
- Unbounded spend. Model spending limits cover model tokens only. Limit searches in the instructions, deny `web_search` in `approvalInTasks` for unattended runs, or require approval in chat with [Human approval](human-approval.md).
- Sensitive queries. The model writes the query from the conversation, so user data can reach the search provider. Leave `web_search` off for Agents that handle secrets or personal data, or tell the Agent never to include them in a query.
- Removing `web_search` while an approval policy overrides it fails. Update the policy in the same change.

## Check it works

- Ask the Agent about something from the last week. The saved assistant message contains a `tool-web_search` part with results, and the answer lists URLs.
- Ask a question that needs no search, such as arithmetic. No `tool-web_search` part appears.
- Remove `web_search` from `tools` and ask the first question again in a new Session. No search runs.

## Go deeper

- [Built-in tools](https://docs.blazingagents.com/agents/tools/built-in-tools)
- [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals)
