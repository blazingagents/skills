# Python Artifacts

The synchronous and asynchronous Python clients expose `artifacts` to list, inspect, download, and delete deliberately published Artifact deliverables.

## Decision and workflow

1. Choose the synchronous or asynchronous client, query through `artifacts`, then acquire content or delete through its current methods.

Read [Artifacts](https://docs.blazingagents.com/agents/artifacts) and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/artifacts).

## Mistakes and verification

The [Artifact concept](../../agents/artifacts.md) owns publication and lifecycle boundaries. Verify sync or async pagination, model conversion, and download/error handling for the operations used.
