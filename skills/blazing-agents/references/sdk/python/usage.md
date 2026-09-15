# Python Usage

The synchronous and asynchronous Python clients expose `usage` to query Tenant usage with current ranges, filters, grouping, and a bounded dashboard overview.

## Decision and workflow

1. Choose the synchronous or asynchronous client.
2. Use `usage.overview(from_=?, to=?, limit=?)` when one dashboard needs totals, daily activity, top Agent/End-user/model breakdowns, and the active Agent count. `limit` defaults to 5 and accepts 1–20; use `get` or `get_for_agent` for a specific filter or grouping.

Read [Usage](https://docs.blazingagents.com/platform/usage-and-quotas) and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/usage).

## Mistakes and verification

The [Usage and quotas concept](../../platform/usage-and-quotas.md) owns metering and quota boundaries. Treat overview totals and daily rows as exhaustive, its rankings as bounded, and the final model bucket with both `provider` and `model` `None` as the aggregate of omitted models. Verify sync or async query serialization, model conversion, aggregate results, and error handling for the dimensions used.
