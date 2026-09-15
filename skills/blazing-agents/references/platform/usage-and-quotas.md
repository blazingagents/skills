# Usage and quotas

Usage records meter Turns and support Tenant reporting. Quotas are Tenant controls applied at admission; Task runs can end blocked before execution.

## Decision and workflow

1. Decide whether the consumer needs the bounded dashboard overview or a specific filter and grouping.
2. Query through the public Usage resource; overview returns exhaustive totals and daily data while bounding Agent, End-user, and model rankings.
3. Handle quota outcomes distinctly from Provider or execution failures and surface recovery guidance appropriate to the application.

Read [Usage and quotas](https://docs.blazingagents.com/platform/usage-and-quotas) and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/usage), [Python](https://docs.blazingagents.com/sdk/python/usage), or [REST](https://docs.blazingagents.com/api-reference/rest-api/usage) references.

## Mistakes and verification

Do not copy pricing, limits, or response schemas into this Skill or treat Attribution as authorization. In an overview, distinguish tenant-level `userId: ""` from the model remainder whose `provider` and `model` are both null; that remainder makes the bounded model distribution sum to the exhaustive totals. Count active Agents independently of the ranking limit. Verify filters/grouping, successful and failed Turn metering, and quota outcomes. Retry choices belong to [Limits and reliability](limits-and-reliability.md).
