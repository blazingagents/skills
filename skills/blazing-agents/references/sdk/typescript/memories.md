# TypeScript Memories

The TypeScript client exposes `client.memories` to create, search, retrieve, update, and delete durable Agent Memory.

## Decision and workflow

1. Create, query, or mutate through `client.memories` with the intended typed scope fields.

Read [Memories](https://docs.blazingagents.com/agents/memory) and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/memories).

## Mistakes and verification

The [Memory concept](../../agents/memory.md) owns scope, injection, and lifecycle boundaries. Verify query serialization, typed pagination, and errors for the methods used.
