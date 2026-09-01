# Workspaces

A Workspace is durable Tenant-owned file state attached to one or more Agents and operated through Workspace Tools. It is not a continuously running sandbox or execution host.

## Decision and workflow

1. Use the Agent's default Workspace or deliberately attach an existing same-Tenant Workspace.
2. Select the required Workspace Tool group.
3. Exercise file operations, then publish intended deliverables as Artifacts.

Read [Workspaces](https://docs.blazingagents.com/agents/workspaces), [Built-in Tools](https://docs.blazingagents.com/agents/tools/built-in-tools), and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/workspaces), [Python](https://docs.blazingagents.com/sdk/python/workspaces), or [REST](https://docs.blazingagents.com/api-reference/rest-api/workspaces) references.

## Mistakes and verification

Distinguish Workspace from Container, Session, and runtime Skill storage. Verify attachment, sharing/isolation, persistence, and network policy. Publication belongs to [Artifacts](artifacts.md).
