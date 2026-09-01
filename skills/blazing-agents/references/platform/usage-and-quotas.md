# Usage and quotas

Usage records meter Turns and support Tenant reporting. Quotas are Tenant controls applied at admission; Task runs can end blocked before execution.

## Decision and workflow

1. Decide the reporting range, filters, and grouping needed.
2. Query through the public Usage resource.
3. Handle quota outcomes distinctly from Provider or execution failures and surface recovery guidance appropriate to the application.

Read [Usage and quotas](https://docs.blazingagents.com/platform/usage-and-quotas) and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/usage), [Python](https://docs.blazingagents.com/sdk/python/usage), or [REST](https://docs.blazingagents.com/api-reference/rest-api/usage) references.

## Mistakes and verification

Do not copy pricing, limits, or response schemas into this Skill or treat Attribution as authorization. Verify filters/grouping, successful and failed Turn metering, and quota outcomes. Retry choices belong to [Limits and reliability](limits-and-reliability.md).
