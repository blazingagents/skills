# TypeScript Usage

The TypeScript client exposes `client.usage` to query Tenant usage with current ranges, filters, and grouping.

## Decision and workflow

1. Set the needed typed reporting dimensions, then query through `client.usage`.

Read [Usage](https://docs.blazingagents.com/platform/usage-and-quotas) and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/usage).

## Mistakes and verification

The [Usage and quotas concept](../../platform/usage-and-quotas.md) owns metering and quota boundaries. Verify query serialization, typed aggregate results, and errors for the dimensions used.
