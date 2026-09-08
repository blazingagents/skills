# Sessions and Turns

A Session owns durable interactive history, Tool-approval state, and continuation. A Turn is one metered Agent execution, whether triggered by chat, stateless generation, or a Task.

## Decision and workflow

1. Use a Session for resumable conversation or approvals; use stateless generation otherwise.
2. Create or resume through the public generation surface.
3. Read Session metadata/messages through the Sessions resource and preserve ordering/pagination contracts.

Read [Sessions and Turns](https://docs.blazingagents.com/platform/sessions-and-turns) and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/sessions), [Python](https://docs.blazingagents.com/sdk/python/sessions), or [REST](https://docs.blazingagents.com/api-reference/rest-api/sessions) references.

## Latest Session per Agent

For an Agent Inbox (one row per Agent showing its most recent Session), call `GET /v1/sessions/latest` (TypeScript `client.sessions.listLatest`, Python `client.sessions.list_latest`) instead of listing Agents and then calling the per-Agent Session list once per Agent. Semantics:

- One item per Agent; an Agent appears at most once and only when it has at least one non-deleted, nonempty Session.
- The item is that Agent's most recently updated Session (`updatedAt` desc). Optional `userId` narrows every Agent to that end user's latest Session with it.
- Items are the per-Agent Session list item plus `agentId`, nullable `model`, nullable `thinkingLevel`, and `status` (`active` or `disabled`), ordered `updatedAt` desc then `id` asc across Agents.
- `limit` and keyset `cursor`/`nextCursor` are identical to the per-Agent list; a malformed cursor is `400 invalid_cursor`.
- Agent fields describe current state, independently of the Session's pinned Version; disabled Agents remain included.
- Tenant scope comes from the credential, as everywhere else.

## Mistakes and verification

Do not call every Turn a Session or assume stateless output creates one. Inspect the current public contract, route, and focused tests together for admission, materialization, and transcript effects; report any disagreement instead of choosing one source silently. Verify create/resume, success/failure/cancellation, and usage. Terminal Session workflows use [`ba chat`](../cli/chat.md), explicit-Session [`ba run`](../cli/run.md), or Admin Agent [`ba assist`](../cli/assist.md). Approvals belong to [Tool approvals](../agents/tools/tool-approvals.md).

For interactive input retention, fresh-ID resend, Stop, and regeneration, read the [chatbot guide](chatbot.md). Failed/canceled execution preserves history and usage; a lost response may still hide a saved exchange.
