# TypeScript Sessions

The TypeScript client exposes `client.sessions` to list and delete durable interactive Sessions, inspect messages, and manage Tool approvals.

## Decision and workflow

1. Use root chat methods for Turns, then use `client.sessions` for typed persisted state and approvals.

Read [Sessions](https://docs.blazingagents.com/platform/sessions-and-turns) and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/sessions).

## Mistakes and verification

The [Sessions and Turns concept](../../platform/sessions-and-turns.md) owns persistence boundaries. Verify query serialization, typed pagination, and approval/error handling for the methods used.
