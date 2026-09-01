# Python Memories

The synchronous and asynchronous Python clients expose `memories` to create, search, retrieve, update, and delete durable Agent Memory.

## Decision and workflow

1. Choose the synchronous or asynchronous client, then create, query, or mutate through `memories` with the intended scope fields.

Read [Memories](https://docs.blazingagents.com/agents/memory) and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/memories).

## Mistakes and verification

The [Memory concept](../../agents/memory.md) owns scope, injection, and lifecycle boundaries. Verify sync or async pagination, model conversion, and errors for the operations used.
