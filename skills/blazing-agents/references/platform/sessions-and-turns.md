# Sessions and Turns

A Session owns durable interactive history, Tool-approval state, and continuation. A Turn is one metered Agent execution, whether triggered by chat, stateless generation, or a Task.

## Decision and workflow

1. Use a Session for resumable conversation or approvals; use stateless generation otherwise.
2. Create or resume through the public generation surface.
3. Read Session metadata/messages through the Sessions resource and preserve ordering/pagination contracts.

Read [Sessions and Turns](https://docs.blazingagents.com/platform/sessions-and-turns) and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/sessions), [Python](https://docs.blazingagents.com/sdk/python/sessions), or [REST](https://docs.blazingagents.com/api-reference/rest-api/sessions) references.

## Mistakes and verification

Do not call every Turn a Session or assume stateless output creates one. Inspect the current public contract, route, and focused tests together for admission, materialization, and transcript effects; report any disagreement instead of choosing one source silently. Verify create/resume, success/failure/cancellation, and usage. Terminal Session workflows use [`ba chat`](../cli/chat.md), explicit-Session [`ba run`](../cli/run.md), or Admin Agent [`ba assist`](../cli/assist.md). Approvals belong to [Tool approvals](../agents/tools/tool-approvals.md).
