# TypeScript Workspaces

The TypeScript client exposes `client.workspaces` to manage durable Workspace metadata and lifecycle.

## Decision and workflow

1. Manage metadata through `client.workspaces`, then attach through `client.agents`.

Read [Workspaces](https://docs.blazingagents.com/agents/workspaces), the [coding-Agent guide](https://docs.blazingagents.com/agents/tools/built-in-tools), and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/workspaces).

## Mistakes and verification

The [Workspace concept](../../agents/workspaces.md) owns attachment, sharing, and execution boundaries. Verify query serialization, typed pagination, and deletion/error handling for the methods used.
