# MCP Tools

MCP Tools come from an MCP Connection attached to an Agent. The Connection owns remote endpoint and authentication state; attachment exposes its Tools to that Agent.

## Decision and workflow

1. Create the Tenant-owned Connection through a supported transport/authentication path.
2. Complete authorization and attach it to the Agent with intended forwarding settings.
3. Run a Turn that discovers and invokes an MCP Tool.

Read [MCP Tools](https://docs.blazingagents.com/agents/tools/mcp-tools), exact Connection references for [TypeScript](https://docs.blazingagents.com/sdk/typescript/mcp-connections), [Python](https://docs.blazingagents.com/sdk/python/mcp-connections), and [REST](https://docs.blazingagents.com/api-reference/rest-api/mcp-connections), plus the Agent attachment references for [TypeScript](https://docs.blazingagents.com/sdk/typescript/agents), [Python](https://docs.blazingagents.com/sdk/python/agents), and [REST](https://docs.blazingagents.com/api-reference/rest-api/agents).

## Mistakes and verification

Do not model an MCP Tool without a Connection or expose credentials to the model or Workspace. Verify authorization, attachment, discovery, invocation, and secret boundaries.
