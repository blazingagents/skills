# TypeScript Usage

The TypeScript client exposes `client.usage` to query Tenant usage with current ranges, filters, grouping, and a bounded dashboard overview.

## Decision and workflow

1. Use `client.usage.overview({ from?, to?, limit? })` when one dashboard needs totals, daily activity, top Agent/End-user/model breakdowns, and the active Agent count. `limit` defaults to 5 and accepts 1–20.
2. Use `get` or `getForAgent` when the report needs a specific filter or grouping.

Read [Usage](https://docs.blazingagents.com/platform/usage-and-quotas) and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/usage).

## Mistakes and verification

The [Usage and quotas concept](../../platform/usage-and-quotas.md) owns metering and quota boundaries. Treat overview totals and daily rows as exhaustive, its rankings as bounded, and the final model bucket with both `provider` and `model` null as the aggregate of omitted models. Verify query serialization, typed aggregate results, and errors for the dimensions used.
