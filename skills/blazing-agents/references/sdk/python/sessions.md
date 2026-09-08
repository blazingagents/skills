# Python Sessions

The synchronous and asynchronous Python clients expose `sessions` to list and delete durable interactive Sessions, inspect messages, and manage Tool approvals.

## Decision and workflow

1. Choose the synchronous or asynchronous client, use root chat methods for Turns, then use `sessions` for persisted state and approvals.

Read [Sessions](https://docs.blazingagents.com/platform/sessions-and-turns) and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/sessions).

## Latest Session per Agent

`client.sessions.list_latest(*, user_id=OMITTED, cursor=OMITTED, limit=OMITTED)` calls `GET /v1/sessions/latest` and returns a page with `data` and `next_cursor`, one item per Agent (the per-Agent list item plus `agent_id`, `model`, `thinking_level`, and `status`). Use it for an Agent Inbox instead of `sessions.list` per Agent; the asynchronous client awaits the same method.

The extra Agent fields describe current configuration and status, independently of the Session's pinned Version. Model and Thinking level may be null; disabled Agents remain included.

```python
page = client.sessions.list_latest(user_id=user_id, limit=50)
for session in page.data:
    render(session.agent_id, session.last_message_preview, session.updated_at)
if page.next_cursor:
    client.sessions.list_latest(user_id=user_id, limit=50, cursor=page.next_cursor)
```

## Mistakes and verification

The [Sessions and Turns concept](../../platform/sessions-and-turns.md) owns persistence boundaries. Verify sync or async pagination, model conversion, and approval/error handling for the operations used.
