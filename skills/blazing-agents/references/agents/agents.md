# Agents

An Agent is the Tenant-owned configuration used to resolve a Turn. Use one when behavior, Provider/model selection, instructions, Tool groups, runtime Skills, MCP Connections, Memory injection, or Workspace attachment must be reused. “Agents” is also a learning category; neighboring resources are not necessarily Agent-owned.

## Decision and workflow

1. Separate reusable Agent configuration from caller-owned Turn input.
2. Create or update through a public SDK or REST API and account for the resulting immutable Version.
3. Configure a Provider/model pair before execution.

Read [Agents](https://docs.blazingagents.com/agents/agents), the [quickstart](https://docs.blazingagents.com/getting-started/quickstart), and the exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/agents), [Python](https://docs.blazingagents.com/sdk/python/agents), or [REST](https://docs.blazingagents.com/api-reference/rest-api/agents) reference.

## Mistakes and verification

Keep Provider and model paired and do not infer ownership from the learning category. Retrieve the Agent after mutation, inspect its latest Version where relevant, and run focused contract tests. Execution belongs to [Sessions and Turns](../platform/sessions-and-turns.md).
