# TypeScript Providers

The TypeScript client exposes `client.providers` to manage Tenant Provider configuration, model discovery, and lifecycle.

## Decision and workflow

1. Manage credentials and discovery through `client.providers`, then configure the typed pair through `client.agents`.

Read [Providers](https://docs.blazingagents.com/agents/providers-and-models) and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/providers).

## Mistakes and verification

The [Providers and models concept](../../agents/providers-and-models.md) owns credential, pairing, and verification boundaries. Verify request redaction, typed discovery results, and errors for the methods used.
