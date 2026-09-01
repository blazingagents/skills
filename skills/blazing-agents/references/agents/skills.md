# Runtime Skills

A runtime Skill is an Agent-owned package of instructions and resources loaded progressively by BA. It is not a Tool. This coding-agent Skill is a separate portable development artifact.

## Decision and workflow

1. Use a runtime Skill for reusable model guidance; use a Tool for an operation.
2. Author against the current package contract, upload to the target Agent, and inspect indexed metadata.
3. Exercise activation and disclosed resource reads in a Turn.

Read [Skills](https://docs.blazingagents.com/agents/skills) and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/skills), [Python](https://docs.blazingagents.com/sdk/python/skills), or [REST](https://docs.blazingagents.com/api-reference/rest-api/skills) references.

## Mistakes and verification

Keep runtime Skills distinct from Tools and Workspace files. Make no coding-agent installation claim. Verify upload, listing, activation, and progressive reads. Operations belong to [Built-in Tools](tools/built-in-tools.md) or [MCP Tools](tools/mcp-tools.md).
