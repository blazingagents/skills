# TypeScript Artifacts

The TypeScript client exposes `client.artifacts` to list, inspect, download, and delete deliberately published Artifact deliverables.

## Decision and workflow

1. Query through `client.artifacts`, then acquire content or delete through its current typed methods.

Read [Artifacts](https://docs.blazingagents.com/agents/artifacts) and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/artifacts).

## Mistakes and verification

The [Artifact concept](../../agents/artifacts.md) owns publication and lifecycle boundaries. Verify query serialization, typed results, and download/error handling for the methods used.
