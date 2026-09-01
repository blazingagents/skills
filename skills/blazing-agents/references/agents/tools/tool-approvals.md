# Tool approvals

A Tool approval is a human decision for one exact sensitive Tool call. Pending request, decision, and continuation are durable Session state; approval never bypasses Tenant scope or product invariants.

## Decision and workflow

1. Start or resume stateful chat that can request approval.
2. Present the pending request without changing its identity or arguments.
3. Submit approve or deny through Session continuation and handle the continued Turn.

Read [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals), [Sessions and Turns](https://docs.blazingagents.com/platform/sessions-and-turns), and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/sessions), [Python](https://docs.blazingagents.com/sdk/python/sessions), or [REST](https://docs.blazingagents.com/api-reference/rest-api/sessions) references.

## Mistakes and verification

Do not implement approval as stateless generation, general permission, or an altered Tool call. Verify approve, deny, exact-call binding, continuation, and timeout/failure paths. Terminal approvals are surfaced by [`ba run`](../../cli/run.md), while Admin Agent approvals continue through [`ba assist`](../../cli/assist.md). Tool catalogs belong to [Built-in Tools](built-in-tools.md) and [MCP Tools](mcp-tools.md).
