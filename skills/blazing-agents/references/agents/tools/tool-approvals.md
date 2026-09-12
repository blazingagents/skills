# Tool approvals

Configure approval on the Agent; keep review and execution on BA's backend.
Approval never grants additional Tool access or crosses Tenant boundaries.

## Configure a policy

- `approvalInChat` applies to chat and stateless generation; `approvalInTasks` applies to Tasks.
- Both default to `{"default":"full","overrides":[]}`. An exact `overrides: [{ tool, decision }]` entry wins over `default`.
- Omitting a policy on update preserves it. Supplying one replaces it; omitted or empty `overrides` clears the list. Both policies are versioned and restored.

| Value | Behavior |
| --- | --- |
| `full` | Execute without approval. |
| `deny` | Block the call. |
| `manual` | Ask a human; block when human review is unavailable. |
| `auto` | Backend model allows, denies, or asks a human. Review failures block. |

Tasks and stateless generation block manual or escalated calls immediately;
other permitted work can continue. Report unfinished work.

Use individual builtin names: `{"type":"builtin","name":"bash"}`. For MCP,
use `{"type":"mcp","connectionId":"mcp_0123456789abcdef","name":"delete_issue"}`
with the original remote name and an attached same-Tenant Connection. Reject
duplicate or unavailable references; update affected rules when removing Tools.

TypeScript SDK 0.8.0 and Python SDK 0.5.0 support these policies. Python uses
`approval_in_chat`, `approval_in_tasks`, and nested `connection_id`.

## Decision and workflow

1. List pending Session approvals and show the saved Tool identity and arguments to an authorized reviewer.
2. Submit their decision against the exact approval ID. Decide every pending call before resuming.
3. Join the returned `continuationId` to read the resumed Agent response; consume the stream through completion or error.

A continuation is resumed execution in the same Session. Keep BA's decision and
join APIs authoritative, including in Vercel AI SDK UIs. Preserve Admin Agent
Tool-specific approval behavior.

Read the [approval guide and AI SDK example](https://docs.blazingagents.com/agents/tools/tool-approvals),
then the exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/sessions),
[Python](https://docs.blazingagents.com/sdk/python/sessions), or
[REST](https://docs.blazingagents.com/api-reference/rest-api/sessions) contract.

## Verify

Test default/override precedence, policy replacement, MCP validation, unattended
denial, auto-review failure, and human approve/deny/resume. Policy modes differ
from persisted approval decisions: `pending`, `approved`, `denied`.
