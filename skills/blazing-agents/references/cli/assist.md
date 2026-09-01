# ba assist

Use `ba assist` for the Tenant's Admin Agent. It is distinct from ordinary Agent chat and remains subject to the documented hosted execution and credential boundaries.

## Decision and workflow

1. Complete [setup and authentication](setup-and-authentication.md).
2. Inspect current Admin Agent prerequisites and available assist modes.
3. Start the supported interaction and treat Tool actions as real hosted effects requiring normal review.

```bash
ba assist
ba assist --session ss_0123456789abcdef
```

Read the exact [ba assist reference](https://docs.blazingagents.com/cli/assist), the [CLI overview](https://docs.blazingagents.com/cli), [Security and credentials](https://docs.blazingagents.com/platform/security-and-credentials), [Sessions and Turns](https://docs.blazingagents.com/platform/sessions-and-turns), and [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals). Inspect the exact Agent contracts for [TypeScript](https://docs.blazingagents.com/sdk/typescript/agents) and [REST](https://docs.blazingagents.com/api-reference/rest-api/agents), plus Session and approval contracts for [TypeScript](https://docs.blazingagents.com/sdk/typescript/sessions), [Python](https://docs.blazingagents.com/sdk/python/sessions), and [REST](https://docs.blazingagents.com/api-reference/rest-api/sessions).

## Mistakes and verification

Do not route ordinary Agent chat through assist or infer local execution. Verify Admin Agent resolution, configured/unconfigured behavior, interaction, Tool activity, and safe cancellation. Ordinary interaction belongs to [ba chat](chat.md).
