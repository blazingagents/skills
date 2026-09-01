# Python Sessions

The synchronous and asynchronous Python clients expose `sessions` to list and delete durable interactive Sessions, inspect messages, and manage Tool approvals.

## Decision and workflow

1. Choose the synchronous or asynchronous client, use root chat methods for Turns, then use `sessions` for persisted state and approvals.

Read [Sessions](https://docs.blazingagents.com/platform/sessions-and-turns) and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/sessions).

## Mistakes and verification

The [Sessions and Turns concept](../../platform/sessions-and-turns.md) owns persistence boundaries. Verify sync or async pagination, model conversion, and approval/error handling for the operations used.
