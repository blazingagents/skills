# Give your agent your own tools through MCP

At the end, your Agent can call tools from your own or a third-party remote MCP server, and the server's credentials never reach the model.

## When to use this

Your agent needs to act on systems outside Blazing Agents: your internal API, a CRM, a ticket tracker, or any service that exposes a remote MCP server. If the tool is only needed in interactive chat and can run inside your own backend, [backend functions](backend-functions.md) are simpler; MCP also serves Tasks, stateless generation, and Slack/Telegram, which functions cannot. If you instead want files, a shell, a to-do list, memory, or web search, switch on built-in tools by name, such as `tools: ["read", "web_search"]`, and read [Built-in tools](https://docs.blazingagents.com/agents/tools/built-in-tools).

## How it works

An MCP Connection stores one server's HTTPS URL and credentials in your Tenant. You attach it to any Agent by adding its ID to the Agent's `mcpConnectionIds`. At the start of every Turn, Blazing Agents connects to each attached server, lists its tools, and offers them to the model. Blazing Agents holds the credentials, refreshes OAuth tokens, and makes the calls, so the model only sees tool names, arguments, and results. Each attachment also decides whether the server receives the Turn's `userId` and selected `metadata` keys.

## Build it

For a Python, Rust, or Go backend, read the code for these steps in [Python](external-tools-mcp.python.md), [Rust](external-tools-mcp.rust.md), [Go](external-tools-mcp.go.md).

Pick the sign-in type your server needs:

| `authType` | Use it when | You send |
| --- | --- | --- |
| `none` | The server needs no credentials. | Nothing extra |
| `bearer` | The server takes a static token. | `bearerToken` |
| `oauth_client_credentials` | The server issues tokens to a machine client. | `clientId`, `clientSecret`, optional `scope` |
| `oauth_authorization_code` | A person must sign in and grant access. | Nothing extra; finish sign-in in the dashboard |

1. Create the Connection once, on your backend. Connections are Tenant administration, so steps 1 and 3 use the unscoped client. For every type except `oauth_authorization_code`, Blazing Agents checks the server first and saves nothing if the check fails.

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

2. If you chose `oauth_authorization_code`, finish sign-in in the dashboard. The Connection starts as `needs_auth`. A Tenant administrator opens MCP connections in the [dashboard](https://www.blazingagents.com/app), clicks **Connect**, and signs in to the server. If the server's authorization server asks for a redirect URL, register `https://api.blazingagents.com/v1/mcp/oauth/callback`. This sign-in needs a signed-in dashboard administrator, so no SDK has a method for it, and the API answers an API key with `unauthorized`.

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

4. Run a Turn that needs the tool, then read the saved Session to confirm the call. Run both on the End-user scoped client, as your app does for a signed-in user. The scope sets the Turn's `userId`, which the attachment forwards, and the Agent must belong to that user. The saved tool part uses a generated name that contains the original tool name.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const agentId: string;
declare const verifiedUserId: string; // e.g. "user_123", from your sign-in check

const tenant = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });
const client = tenant.forUser(verifiedUserId);

const result = await client.chat({
  agentId,
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

## Gotchas

- Put credentials only in the Connection's credential fields. Keep tokens out of the Connection name, URL, Agent instructions, Prompts, Turn `metadata`, and messages; anything there can reach the model or your logs. Responses never return stored credentials.
- The URL must be HTTPS with no credentials, query string, or fragment. Put API keys in `bearerToken` or OAuth fields, not in `?key=`.
- Sending `mcpConnectionIds` replaces the list. Read the Agent first and merge, or you detach other Connections.
- A Connection in `needs_auth` or an unreachable server fails the whole Turn with `mcp_connection_discovery_failed` (502), and a failing tool can fail it too. Blazing Agents never quietly runs with fewer tools. Handle the failed Turn and prompt an administrator to reconnect, or detach the Connection.
- Forwarded `userId` and metadata are information for the server, not authorization. Your MCP server must still check what that user may do. Forward only what the server needs.
- Tools are discovered live every Turn. Rerun `test()` after you change credentials or deploy the server.
- `reconnect()` swaps URL and credentials under the same ID, which also changes what existing Sessions and Task runs use. Detach a Connection from every Agent before you delete it.
- MCP tools follow the Agent's approval policies. Target one with `{ type: "mcp", connectionId, name }` using the original tool name; see [human-approval.md](human-approval.md). If the server later renames or removes a tool that an approval override names, every Turn of that Agent fails with `mcp_connection_discovery_failed` until you remove the override, so change overrides and server deploys together.
- An MCP Connection is Tenant administration: create, test, reconnect, and delete it on the unscoped client. A scoped client can only list and toggle the attachments of the user's own Agent.
- Limits: 50 Connections per Tenant, 10 per Agent, 128 tools per Connection, 256 tools per Turn (more fails the Turn), 1 MiB per tool result, and 60 seconds per tool call. See [Limits](../limits.md).

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
