# TypeScript Sessions

The TypeScript client exposes `client.sessions` to list and delete durable interactive Sessions, inspect messages, and manage Tool approvals.

## Decision and workflow

1. Use root chat methods for Turns, then use `client.sessions` for typed persisted state and approvals.

Read [Sessions](https://docs.blazingagents.com/platform/sessions-and-turns) and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/sessions).

## Latest Sessions

`client.sessions.listLatest({ userId?, byAgent?, cursor?, limit?, abortSignal? })` calls `GET /v1/sessions/latest` and returns `{ data: LatestSessionListItem[], nextCursor }`. The default `byAgent: false` returns recent Sessions globally and may repeat an Agent. Set `byAgent: true` for at most one latest Session per Agent and use that mode for an Agent Inbox instead of `client.sessions.list` per Agent. `userId` is sent whenever it is defined, including an empty string.

The extra Agent fields describe current configuration and status, independently of the Session's pinned Version. Model and Thinking level may be null; disabled Agents remain included.

```ts
const page = await client.sessions.listLatest({ userId, byAgent: true, limit: 50 });
for (const session of page.data) {
	render(session.agentId, session.lastMessagePreview, session.updatedAt);
}
if (page.nextCursor) {
	await client.sessions.listLatest({ userId, byAgent: true, limit: 50, cursor: page.nextCursor });
}
```

## Mistakes and verification

The [Sessions and Turns concept](../../platform/sessions-and-turns.md) owns persistence boundaries. Verify query serialization, typed pagination, and approval/error handling for the methods used.

## Human approval context

SDK 0.8.0 adds optional `tool`, `assistantMessageId`, `createdAt`, and `decidedAt`
approval metadata. Use existing list/decide/join methods for the
[human approval workflow](../../agents/tools/tool-approvals.md#decision-and-workflow).
