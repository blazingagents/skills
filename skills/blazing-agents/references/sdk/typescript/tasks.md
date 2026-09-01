# TypeScript Tasks

The TypeScript client exposes `client.tasks` to manage Task definitions and their Task runs, including start, observation, messages, and cancellation.

## Decision and workflow

1. Manage definitions and Task runs through `client.tasks`, then observe the typed run result to a terminal state.

Read [Tasks](https://docs.blazingagents.com/automation/tasks) and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/tasks).

## Mistakes and verification

The [Task](../../automation/tasks.md), [Task run](../../automation/task-runs.md), and [schedule](../../automation/schedules.md) concepts own lifecycle boundaries. Verify query serialization, typed pagination, and cancellation/error handling for the methods used.
