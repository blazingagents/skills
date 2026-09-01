# Security and credentials

BA API credentials and Provider credentials belong at trusted backend boundaries. Workspace operations and model-visible input must remain secret-free. Tenant isolation and Attribution belong to [Tenancy and Attribution](tenancy-and-attribution.md).

## Decision and workflow

1. Choose the supported backend credential for the calling surface.
2. Store and inject it through the host's secret mechanism.
3. Keep frontend requests behind the Tenant backend and send only required Attribution/input to BA.
4. Rotate or revoke through current public credential workflows.

Read [Security and credentials](https://docs.blazingagents.com/platform/security-and-credentials), [connect your app](https://docs.blazingagents.com/getting-started/connect-your-app), and [REST authentication](https://docs.blazingagents.com/api-reference/rest-api/authentication).

## Mistakes and verification

Keep secrets out of browser code, logs, metadata, Tool arguments, and Workspaces. Verify authorized success, invalid/revoked failure, redaction, and secret boundaries. Tenant-authority mistakes belong to [Tenancy and Attribution](tenancy-and-attribution.md); terminal credential handling belongs to [CLI setup and authentication](../cli/setup-and-authentication.md); Provider setup belongs to [Providers and models](../agents/providers-and-models.md).
