# TypeScript Tenant

The TypeScript client exposes `client.tenant` to read and manage the current credential-derived Tenant surface.

## Decision and workflow

1. Authenticate the root client for the intended Tenant, then call the singleton `client.tenant` resource.

Read [Tenant](https://docs.blazingagents.com/platform/tenancy-and-attribution) and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/tenant).

## Mistakes and verification

The [Tenancy and Attribution concept](../../platform/tenancy-and-attribution.md) owns isolation and Attribution boundaries. Verify request serialization, typed results, and errors for the singleton methods used.
