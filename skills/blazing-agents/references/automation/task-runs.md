# Task runs

A Task run is one asynchronous execution of a Task, with its own lifecycle and fresh Session once execution begins.

## Decision and workflow

1. Start through the Task resource or identify the run created by a schedule.
2. Poll or list with current pagination/status contracts, retrieve messages when execution has a Session, and cancel only through the supported operation.
3. Diagnose terminal status using current error and usage details.

Read [Task runs](https://docs.blazingagents.com/automation/task-runs), [Tasks](https://docs.blazingagents.com/automation/tasks), exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/tasks) and [Python](https://docs.blazingagents.com/sdk/python/tasks) Task resources, and [REST Task-run](https://docs.blazingagents.com/api-reference/rest-api/task-runs) endpoints.

## Mistakes and verification

Do not equate a Task run with its Task, Session, or Turn; do not classify a quota-blocked run as an execution failure. Verify queued-to-terminal behavior, Session creation boundary, cancellation, messages, and usage.
