# TypeScript client

`BlazingAgents` owns construction, request options and correlation, Agent-scoped selection, resource objects, and direct `chat`, `completion`, and `object` methods.

## Decision and workflow

1. Construct a client at the chosen [credential boundary](../../platform/security-and-credentials.md) and reuse it within one credential/Tenant and endpoint scope. On replacement, retire the old client, caches, and subscriptions; prevent late results from updating the new scope even if cancellation is unavailable.
2. Use root methods for Output, `client.agent(agentId)` for Agent-scoped resources, and top-level resource objects for other CRUD/lifecycle operations.
3. Preserve native streams and handle `BlazingAgentsError` at the operation boundary.

Read [connect your app](https://docs.blazingagents.com/getting-started/connect-your-app), [security and credentials](https://docs.blazingagents.com/platform/security-and-credentials), and the exact [TypeScript client](https://docs.blazingagents.com/sdk/typescript/client) reference.

## Chat transport and runtime

`BlazingAgentsChatTransport` targets the application's backend relay. `client.chat()` owns direct BA create/resume routing; pointing the relay transport at BA does not adapt it. For an explicitly requested direct integration, inspect the installed SDK's exports for a direct `useChat` adapter before building a bridge through `client.chat()` and AI SDK's decoder. Preserve message identity, trigger, early Session identity, and AbortSignal.

For chat and terminal continuation results, use `toResponse()` in runtimes whose Response constructor supports streaming bodies. Otherwise, use `toStream()` with the existing protocol decoder when the installed SDK provides it. Both accessors share one-shot ownership: choose before consuming. A streaming fetch implementation does not establish Response-constructor compatibility; a Session ID does not establish a usable stream body. Verify capabilities against the installed artifact, since a source build can share a published release's version without sharing its exports.

## Mistakes and verification

Preserve caller/server request-ID ownership and the native stream. Verify construction and reuse, correlation/observation, one resource call, and each generation mode used. Credential placement belongs to [Security and credentials](../../platform/security-and-credentials.md); resource details belong to sibling references.
