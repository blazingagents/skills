# Providers and models

A Provider stores Tenant-owned model-provider configuration and credentials; an Agent Version selects a Provider and provider-native model together.

## Decision and workflow

1. Choose a currently supported Provider and create it from a trusted backend.
2. Discover its advertised models, assign its ID and a model to an Agent, then verify the credential with a representative Turn; discovery alone does not prove execution access.
3. Treat an unconfigured Agent as explicit state, with no platform credential fallback.

Read [Models and Providers](https://docs.blazingagents.com/agents/providers-and-models) and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/providers), [Python](https://docs.blazingagents.com/sdk/python/providers), or [REST](https://docs.blazingagents.com/api-reference/rest-api/providers) references.

## Mistakes and verification

Keep credentials out of clients, logs, metadata, and Workspaces. Avoid embedding a model catalog as a durable contract. Verify model discovery's documented limits and the resolved Agent Provider/model pair with a representative Turn. Credential placement belongs to [Security and credentials](../platform/security-and-credentials.md).
