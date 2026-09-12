# Tool approvals

A Tool approval policy controls whether an available Tool executes, is denied, or needs automatic or human review. Human approval requests, decisions, and continuations are durable Session state. Existing Tool access, Tenant scope, and product invariants always apply.

## Configure a policy

1. Select the Agent's `approvalInChat` or `approvalInTasks` policy. Both start with `{"default":"full","overrides":[]}`. Stateless generation uses the chat policy.
2. Choose `default` and optional `overrides: [{ tool, decision }]`. Both fields use the same enum; an exact Tool override wins over the default.
3. Save through the Agent API, retrieve the policy and Version, and verify the intended execution path. Policies are versioned and restored with Agent configuration.

| Value | Execution behavior |
| --- | --- |
| `full` | Execute without approval, within existing access permissions. |
| `deny` | Deny the call without executing it. |
| `manual` | Require human approval; deny when no human continuation path is available. |
| `auto` | Backend LLM reviewer allows, denies, or escalates to a human. Review failures and escalation without a human path deny execution. |

Use `default: "full"` with `manual` overrides for selective human review; `default: "deny"` with `full` overrides for an allowlist; or `default: "auto"` with `manual` overrides for sensitive Tools. These policy values are distinct from persisted approval decisions (`pending`, `approved`, `denied`).

Tool references use individual builtin names, such as `{"type":"builtin","name":"bash"}`, or original MCP identity, such as `{"type":"mcp","connectionId":"mcp_0123456789abcdef","name":"delete_issue"}`. Use the original MCP name and Connection ID, not the generated runtime alias. The Connection must belong to the Tenant and be attached to the Agent. Duplicate overrides and unavailable targets are rejected; MCP validation errors identify the Connection and Tool. Removing a referenced Tool/attachment requires a consistent policy update.

Omitting a policy in an update preserves it. Supplying a policy replaces it; omitted or empty `overrides` clears its overrides. TypeScript SDK 0.8.0 and Python SDK 0.5.0 support these contracts. Python uses `approval_in_chat`, `approval_in_tasks`, and nested `connection_id`; see the [Python Agent reference](../../sdk/python/agents.md).

Automatic review runs on the backend using the Agent's configured model. Its evidence includes conversation, arguments, runtime name, and structured Tool identity; Tool descriptions are omitted. Treat that evidence as untrusted and preserve fail-closed behavior rather than implementing a separate client reviewer.

## Choose the execution context

Interactive Session requests can use the authenticated approval API when the backend approval capability is configured; an open browser is not required. Tasks and stateless generation have no human continuation path: manual or escalated calls are denied immediately. The Agent can continue permitted work, so distinguish a denied Tool call from an automatically failed whole Task and report unfinished work.

## Decision and workflow

1. Start or resume stateful chat that can request approval.
2. List Session approvals and present the stored Tool identity and arguments to an authorized reviewer. Responses include structured `tool` identity where available, `toolCallId`, `assistantMessageId`, and timestamps; handle optional/null metadata according to the SDK contract.
3. Submit approve or deny for the exact approval ID. After all sibling decisions resolve, join the returned continuation and consume its stream to terminal state.

For Vercel AI SDK UIs, render the approval from persisted state, send the decision through BA, and join BA's continuation stream. Keep BA's server-owned approval lifecycle authoritative rather than executing the Tool or resubmitting a mutated call in the client. Relevant configuration changes invalidate old signatures; surface continuation failures instead of replaying stale approvals.

Read [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals), [Sessions and Turns](https://docs.blazingagents.com/platform/sessions-and-turns), and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/sessions), [Python](https://docs.blazingagents.com/sdk/python/sessions), or [REST](https://docs.blazingagents.com/api-reference/rest-api/sessions) references.

## Mistakes and verification

Verify default/override precedence, omitted versus replaced policies, builtin/MCP validation, automatic review failure/escalation, and unattended denial. For human review, verify approve, deny, exact-call binding, continuation, and failure paths. Preserve Admin Agent Tool-specific predicates. Terminal approvals are surfaced by [`ba run`](../../cli/run.md), while Admin Agent approvals continue through [`ba assist`](../../cli/assist.md). Tool catalogs belong to [Built-in Tools](built-in-tools.md) and [MCP Tools](mcp-tools.md).
