# Give your agent your own tools through MCP

At the end, your Agent can call tools from your own or a third-party remote MCP server, and the server's credentials never reach the model.

## When to use this

Your agent needs to act on systems outside Blazing Agents: your internal API, a CRM, a ticket tracker, or any service that exposes a remote MCP server. If you instead want files, a shell, a to-do list, or memory, switch on built-in tool groups with `tools: ["workspace"]` and read [Built-in tools](https://docs.blazingagents.com/agents/tools/built-in-tools).

## How it works

An MCP Connection stores one server's HTTPS URL and credentials in your Tenant. You attach it to any Agent by adding its ID to the Agent's `mcpConnectionIds`. At the start of every Turn, Blazing Agents connects to each attached server, lists its tools, and offers them to the model. Blazing Agents holds the credentials, refreshes OAuth tokens, and makes the calls, so the model only sees tool names, arguments, and results. Each attachment also decides whether the server receives the Turn's `userId` and selected `metadata` keys.

## Build it

Pick the sign-in type your server needs:

| `authType` | Use it when | You send |
| --- | --- | --- |
| `none` | The server needs no credentials. | Nothing extra |
| `bearer` | The server takes a static token. | `bearerToken` |
| `oauth_client_credentials` | The server issues tokens to a machine client. | `clientId`, `clientSecret`, optional `scope` |
| `oauth_authorization_code` | A person must sign in and grant access. | Nothing extra; finish sign-in in the dashboard |

1. Create the Connection once, on your backend. For every type except `oauth_authorization_code`, Blazing Agents checks the server first and saves nothing if the check fails.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const client = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });

const connection = await client.mcpConnections.create({
  name: "Customer tools",
  url: "https://mcp.example.com/v1",
  authType: "bearer",
  bearerToken: process.env.CUSTOMER_MCP_TOKEN ?? "",
});
console.log(connection.id, connection.status);
```

```python
import os

from blazing_agents import BlazingAgents

client = BlazingAgents()  # reads BLAZING_AGENTS_API_KEY

connection = client.mcp_connections.create(
    name="Customer tools",
    url="https://mcp.example.com/v1",
    auth_type="bearer",
    bearer_token=os.environ["CUSTOMER_MCP_TOKEN"],
)
print(connection.id, connection.status)
```

2. If you chose `oauth_authorization_code`, finish sign-in in the dashboard. The Connection starts as `needs_auth`. A Tenant administrator opens MCP connections in the [dashboard](https://www.blazingagents.com/app), clicks **Connect**, and signs in to the server. If the server's authorization server asks for a redirect URL, register `https://api.blazingagents.com/v1/mcp/oauth/callback`. The SDK `connect()` method needs a signed-in dashboard administrator, so it fails with `unauthorized` when called with an API key.

3. Test the Connection, attach it to the Agent, and choose what end-user context the server receives. `mcpConnectionIds` replaces the Agent's whole list, so add to the current one.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const agentId: string; // e.g. "ag_0123456789abcdef"
declare const mcpConnectionId: string;

const client = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });

const test = await client.mcpConnections.test({ mcpConnectionId });
if (!test.ok) throw new Error(`${test.error.code}: ${test.error.message}`);
if (!test.toolNames.includes("lookup_customer")) {
  throw new Error(`Expected lookup_customer, got ${test.toolNames.join(", ")}`);
}

const agent = await client.agents.get({ agentId });
await client.agents.update({
  agentId,
  mcpConnectionIds: [...new Set([...agent.mcpConnectionIds, mcpConnectionId])],
});

await client.agents.updateMcpAttachment({
  agentId,
  mcpConnectionId,
  forwardUserId: true,
  forwardedMetadataKeys: ["plan"],
});
```

```python
from blazing_agents import BlazingAgents


def attach(agent_id: str, mcp_connection_id: str) -> None:
    client = BlazingAgents()

    test = client.mcp_connections.test(mcp_connection_id)
    if test.error is not None:
        raise RuntimeError(f"{test.error.code}: {test.error.message}")
    if "lookup_customer" not in (test.tool_names or []):
        raise RuntimeError(f"Expected lookup_customer, got {test.tool_names}")

    agent = client.agents.get(agent_id)
    if mcp_connection_id not in agent.mcp_connection_ids:
        client.agents.update(
            agent_id,
            mcp_connection_ids=[*agent.mcp_connection_ids, mcp_connection_id],
        )

    client.agents.update_mcp_attachment(
        agent_id,
        mcp_connection_id,
        forward_user_id=True,
        forwarded_metadata_keys=["plan"],
    )
```

4. Run a Turn that needs the tool, then read the saved Session to confirm the call. The saved tool part uses a generated name that contains the original tool name.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const agentId: string;

const client = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });

const result = await client.chat({
  agentId,
  userId: "user_123",
  metadata: { plan: "pro" },
  message: {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text: "Look up customer 42 and summarize their account." }],
  },
});
await result.toResponse().text(); // Drain the stream; in an app, relay it to the browser instead.

const sessionId = await result.sessionId;
const page = await client.sessions.messages({ agentId, sessionId });
const called = page.data.some((message) =>
  message.parts.some((part) => part.type.includes("lookup_customer")),
);
console.log(sessionId, called ? "MCP tool was called" : "MCP tool was not called");
```

```python
import uuid

from blazing_agents import BlazingAgents


def check_tool_call(agent_id: str) -> None:
    client = BlazingAgents()
    with client.chat(
        agent_id=agent_id,
        user_id="user_123",
        metadata={"plan": "pro"},
        message={
            "id": str(uuid.uuid4()),
            "role": "user",
            "parts": [{"type": "text", "text": "Look up customer 42 and summarize their account."}],
        },
    ) as stream:
        for _chunk in stream:
            pass  # Drain the stream; in an app, relay the raw bytes to the browser instead.
        session_id = stream.session_id

    page = client.sessions.messages(agent_id=agent_id, session_id=session_id)
    called = any("lookup_customer" in part.type for m in page.data for part in m.parts)
    print(session_id, "MCP tool was called" if called else "MCP tool was not called")
```

## Gotchas

- Put credentials only in the Connection's credential fields. Keep tokens out of the Connection name, URL, Agent instructions, Prompts, Turn `metadata`, and messages; anything there can reach the model or your logs. Responses never return stored credentials.
- The URL must be HTTPS with no credentials, query string, or fragment. Put API keys in `bearerToken` or OAuth fields, not in `?key=`.
- Sending `mcpConnectionIds` replaces the list. Read the Agent first and merge, or you detach other Connections.
- A Connection in `needs_auth`, an unreachable server, or a failing tool fails the whole Turn. Blazing Agents never quietly runs with fewer tools. Handle the failed Turn and prompt an administrator to reconnect.
- Forwarded `userId` and metadata are information for the server, not authorization. Your MCP server must still check what that user may do. Forward only what the server needs.
- Tools are discovered live every Turn. Rerun `test()` after you change credentials or deploy the server.
- `reconnect()` swaps URL and credentials under the same ID, which also changes what pinned older Agent versions use. Detach a Connection from every Agent before you delete it.
- MCP tools follow the Agent's approval policies. Target one with `{ type: "mcp", connectionId, name }` using the original tool name; see [human-approval.md](human-approval.md).

## Check it works

- `test()` returns `ok: true` and lists the tool names you expect.
- `client.agents.listMcpAttachments({ agentId })` shows the Connection with the forwarding settings you chose.
- Step 4 prints "MCP tool was called", and your MCP server logs the call.
- With forwarding on, your server receives the Turn's context in the MCP request `_meta` under `com.blazingagents/request-context`, for example `{ "userId": "user_123", "metadata": { "plan": "pro" } }`.
- Search the Session messages for your token's value; it never appears.

## Go deeper

- [MCP tools](https://docs.blazingagents.com/agents/tools/mcp-tools)
- [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals)
- [Security and credentials](https://docs.blazingagents.com/platform/security-and-credentials)
- MCP connections in the [TypeScript SDK](https://docs.blazingagents.com/sdk/typescript/mcp-connections), [Python SDK](https://docs.blazingagents.com/sdk/python/mcp-connections), and [REST API](https://docs.blazingagents.com/api-reference/rest-api/mcp-connections)
- Attachment settings in the [TypeScript SDK](https://docs.blazingagents.com/sdk/typescript/agents) and [Python SDK](https://docs.blazingagents.com/sdk/python/agents)
