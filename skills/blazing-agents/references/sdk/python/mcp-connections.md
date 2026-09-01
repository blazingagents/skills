# Python MCP Connections

The synchronous and asynchronous Python clients expose `mcp_connections` to manage Tenant MCP Connection configuration and authorization lifecycle.

## Decision and workflow

1. Choose the synchronous or asynchronous client, manage the Connection through `mcp_connections`, then use `agents` for attachment.

Read [MCP Connections](https://docs.blazingagents.com/agents/tools/mcp-tools) and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/mcp-connections).

## Mistakes and verification

The [MCP Tools concept](../../agents/tools/mcp-tools.md) owns Connection, attachment, and secret boundaries. Verify sync or async authorization results, model conversion, and errors for the operations used.
