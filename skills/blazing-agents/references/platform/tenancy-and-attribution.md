# Tenancy and Attribution

A Tenant is the credential-derived isolation boundary. Attribution is optional caller-supplied `userId` and metadata carried on resources for filtering and reporting; it is never authentication or authorization.

## Decision and workflow

1. Authenticate the Tenant backend with its own credential.
2. Derive Tenant context only from that credential.
3. Forward opaque end-user Attribution when the application needs partitioning or reporting, while enforcing application authorization in the backend.

Read [Tenancy and Attribution](https://docs.blazingagents.com/platform/tenancy-and-attribution) and [REST authentication](https://docs.blazingagents.com/api-reference/rest-api/authentication).

## Mistakes and verification

Never accept `tenantId` from a caller as authority or use Attribution as access control. Verify two-Tenant isolation, intended `userId` propagation/filtering, and backend authorization. Credential handling belongs to [Security and credentials](security-and-credentials.md).
