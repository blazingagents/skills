# Built-in Tools

Built-in Tools are BA-hosted operations selected as Tool groups on Agent configuration. Use them when the model should choose a supported operation.

## Decision and workflow

1. Select only Tool groups required by the Agent's job.
2. Configure prerequisites such as a Workspace.
3. Run a representative Turn and observe Tool success, failure, and approval boundaries.

Read [Built-in Tools](https://docs.blazingagents.com/agents/tools/built-in-tools). Selection uses exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/agents), [Python](https://docs.blazingagents.com/sdk/python/agents), or [REST](https://docs.blazingagents.com/api-reference/rest-api/agents) Agent contracts; no Tools client object exists.

## Mistakes and verification

Do not invent a Tools resource, classify runtime Skills as Tools, or treat Tool selection as authority beyond product boundaries. Verify selection plus success and failure paths. Remote Tools belong to [MCP Tools](mcp-tools.md); approvals to [Tool approvals](tool-approvals.md).
