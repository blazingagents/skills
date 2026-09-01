# Memory

Memory is durable Agent context stored independently of Session history. Use it for facts that should survive across Sessions; keep conversation transcripts in Sessions.

## Decision and workflow

1. Choose explicit Memory CRUD/search or Agent memory injection.
2. Preserve Tenant and Agent scope plus any intended Attribution partition.
3. Test retrieval in a Turn when injection is enabled.

Read [Memory](https://docs.blazingagents.com/agents/memory) and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/memories), [Python](https://docs.blazingagents.com/sdk/python/memories), or [REST](https://docs.blazingagents.com/api-reference/rest-api/memories) references.

## Mistakes and verification

Do not use Memory as authorization state or duplicate Session transcripts. Verify scope, retrieval/search, and injection behavior. History belongs to [Sessions and Turns](../platform/sessions-and-turns.md).
