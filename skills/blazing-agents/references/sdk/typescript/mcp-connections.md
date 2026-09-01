# TypeScript MCP Connections

The TypeScript client exposes `client.mcpConnections` to manage Tenant MCP Connection configuration and authorization lifecycle.

## Decision and workflow

1. Manage the Connection through `client.mcpConnections`, then use `client.agents` for attachment.

Read [MCP Connections](https://docs.blazingagents.com/agents/tools/mcp-tools) and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/mcp-connections).

## Mistakes and verification

The [MCP Tools concept](../../agents/tools/mcp-tools.md) owns Connection, attachment, and secret boundaries. Verify request serialization, typed authorization results, and errors for the methods used.
