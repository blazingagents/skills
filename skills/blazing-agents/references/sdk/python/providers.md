# Python Providers

The synchronous and asynchronous Python clients expose `providers` to manage Tenant Provider configuration, model discovery, and lifecycle.

## Decision and workflow

1. Choose the synchronous or asynchronous client, manage credentials and discovery through `providers`, then configure the pair through `agents`.

Read [Providers](https://docs.blazingagents.com/agents/providers-and-models) and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/providers).

## Mistakes and verification

The [Providers and models concept](../../agents/providers-and-models.md) owns credential, pairing, and verification boundaries. Verify sync or async model conversion, redaction, and errors for the operations used.
