# TypeScript Sessions

The TypeScript client exposes `client.sessions` to list and delete durable interactive Sessions, inspect messages, and manage Tool approvals.

## Decision and workflow

1. Use root chat methods for Turns, then use `client.sessions` for typed persisted state and approvals.

Read [Sessions](https://docs.blazingagents.com/platform/sessions-and-turns) and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/sessions).

## Latest Session per Agent

`client.sessions.listLatest({ userId?, cursor?, limit?, abortSignal? })` calls `GET /v1/sessions/latest` and returns `{ data: LatestSessionListItem[], nextCursor }`, one item per Agent (the per-Agent list item plus `agentId`). Use it for an Agent Inbox instead of `client.sessions.list` per Agent; `userId` is sent whenever it is defined, including an empty string.

```ts
const page = await client.sessions.listLatest({ userId, limit: 50 });
for (const session of page.data) {
	render(session.agentId, session.lastMessagePreview, session.updatedAt);
}
if (page.nextCursor) {
	await client.sessions.listLatest({ userId, limit: 50, cursor: page.nextCursor });
}
```

## Mistakes and verification

The [Sessions and Turns concept](../../platform/sessions-and-turns.md) owns persistence boundaries. Verify query serialization, typed pagination, and approval/error handling for the methods used.
