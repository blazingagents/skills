# Python Usage

The synchronous and asynchronous Python clients expose `usage` to query Tenant usage with current ranges, filters, and grouping.

## Decision and workflow

1. Choose the synchronous or asynchronous client, set the needed reporting dimensions, then query through `usage`.

Read [Usage](https://docs.blazingagents.com/platform/usage-and-quotas) and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/usage).

## Mistakes and verification

The [Usage and quotas concept](../../platform/usage-and-quotas.md) owns metering and quota boundaries. Verify sync or async query serialization, model conversion, aggregate results, and error handling for the dimensions used.
