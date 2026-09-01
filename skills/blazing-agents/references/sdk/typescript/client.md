# TypeScript client

`BlazingAgents` owns construction, request options and correlation, Agent-scoped selection, resource objects, and direct `chat`, `completion`, and `object` methods.

## Decision and workflow

1. Construct one client in a trusted backend with current credential, base URL, and transport options, then reuse it for the application's lifetime.
2. Use root methods for Output, `client.agent(agentId)` for Agent-scoped resources, and top-level resource objects for other CRUD/lifecycle operations.
3. Preserve native streams and handle `BlazingAgentsError` at the operation boundary.

Read [connect your app](https://docs.blazingagents.com/getting-started/connect-your-app), [security and credentials](https://docs.blazingagents.com/platform/security-and-credentials), and the exact [TypeScript client](https://docs.blazingagents.com/sdk/typescript/client) reference.

## Mistakes and verification

Preserve caller/server request-ID ownership and the native stream. Verify construction and reuse, correlation/observation, one resource call, and each generation mode used. Credential placement belongs to [Security and credentials](../../platform/security-and-credentials.md); resource details belong to sibling references.
