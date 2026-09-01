# Python Workspaces

The synchronous and asynchronous Python clients expose `workspaces` to manage durable Workspace metadata and lifecycle.

## Decision and workflow

1. Choose the synchronous or asynchronous client, manage metadata through `workspaces`, then attach through `agents`.

Read [Workspaces](https://docs.blazingagents.com/agents/workspaces), the [coding-Agent guide](https://docs.blazingagents.com/agents/tools/built-in-tools), and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/workspaces).

## Mistakes and verification

The [Workspace concept](../../agents/workspaces.md) owns attachment, sharing, and execution boundaries. Verify sync or async pagination, model conversion, and deletion/error handling for the operations used.
