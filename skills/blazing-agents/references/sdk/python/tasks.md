# Python Tasks

The synchronous and asynchronous Python clients expose `tasks` to manage Task definitions and their Task runs, including start, observation, messages, and cancellation.

## Decision and workflow

1. Choose the synchronous or asynchronous client, manage definitions and Task runs through `tasks`, then observe the run to a terminal result.

Read [Tasks](https://docs.blazingagents.com/automation/tasks) and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/tasks).

## Mistakes and verification

The [Task](../../automation/tasks.md), [Task run](../../automation/task-runs.md), and [schedule](../../automation/schedules.md) concepts own lifecycle boundaries. Verify sync or async pagination, model conversion, and cancellation/error handling for the operations used.
