# Python Tenant

The synchronous and asynchronous Python clients expose `tenant` to read and manage the current credential-derived Tenant surface.

## Decision and workflow

1. Choose the synchronous or asynchronous client, authenticate it for the intended Tenant, then call the singleton `tenant` resource.

Read [Tenant](https://docs.blazingagents.com/platform/tenancy-and-attribution) and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/tenant).

## Mistakes and verification

The [Tenancy and Attribution concept](../../platform/tenancy-and-attribution.md) owns isolation and Attribution boundaries. Verify sync or async model conversion and errors for the singleton operations used.
