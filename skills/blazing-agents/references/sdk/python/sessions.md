# Python Sessions

The synchronous and asynchronous Python clients expose `sessions` to list and delete durable interactive Sessions, inspect messages, and manage Tool approvals.

## Decision and workflow

1. Choose the synchronous or asynchronous client, use root chat methods for Turns, then use `sessions` for persisted state and approvals.

Read [Sessions](https://docs.blazingagents.com/platform/sessions-and-turns) and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/sessions).

## Latest Sessions

`client.sessions.list_latest(*, user_id=OMITTED, by_agent: bool | None = None, cursor=OMITTED, limit=OMITTED)` calls `GET /v1/sessions/latest` and returns a page with `data` and `next_cursor`. `by_agent=None` uses the API default and returns recent Sessions globally, as does explicit `False`; either mode may repeat an Agent. Set `by_agent=True` for at most one latest Session per Agent and use that mode for an Agent Inbox instead of `sessions.list` per Agent; the asynchronous client awaits the same method.

The extra Agent fields describe current configuration and status, independently of the Session's pinned Version. Model and Thinking level may be null; disabled Agents remain included.

```python
page = client.sessions.list_latest(user_id=user_id, by_agent=True, limit=50)
for session in page.data:
    render(session.agent_id, session.last_message_preview, session.updated_at)
if page.next_cursor:
    client.sessions.list_latest(user_id=user_id, by_agent=True, limit=50, cursor=page.next_cursor)
```

## Mistakes and verification

The [Sessions and Turns concept](../../platform/sessions-and-turns.md) owns persistence boundaries. Verify sync or async pagination, model conversion, and approval/error handling for the operations used.

## Human approval context

SDK 0.5.0 adds `tool`, `assistant_message_id`, `created_at`, and `decided_at`
approval metadata. Both clients use existing list/decide/join methods for the
[human approval workflow](../../agents/tools/tool-approvals.md#decision-and-workflow).
