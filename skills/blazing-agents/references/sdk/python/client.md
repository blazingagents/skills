# Python client

`BlazingAgents` and `AsyncBlazingAgents` own construction, transport options, request correlation, Agent-scoped selection, lifecycle, errors, and direct chat/completion/object methods. Choose the synchronous client for synchronous code and the asynchronous client for native async code; their resources are otherwise equivalent.

## Decision and workflow

1. Construct the client in a trusted backend with the current package's credential and transport options.
2. Use root generation methods for Output, `client.agent(agent_id)` for Agent-scoped resources, and top-level resource objects for other CRUD/lifecycle operations.
3. Close owned transport resources and handle SDK errors at the operation boundary.

Read [connect your app](https://docs.blazingagents.com/getting-started/connect-your-app), [security and credentials](https://docs.blazingagents.com/platform/security-and-credentials), and the exact [Python client](https://docs.blazingagents.com/sdk/python/client) reference.

## Mistakes and verification

Use one concurrency model per call path and preserve transport ownership. Verify construction, response observation/correlation, close behavior, one resource call, and each generation mode used. Credential placement belongs to [Security and credentials](../../platform/security-and-credentials.md); resource details belong to their sibling references.
