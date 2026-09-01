# Schedules

A schedule is optional timing on a Task. Use one-time, interval, or cron timing according to the current Task contract; an unscheduled Task runs only on demand.

## Decision and workflow

1. Choose timing semantics and timezone behavior from current docs.
2. Create or update the Task's schedule through the public Task resource.
3. Observe generated Task runs and verify overlap, disablement, and update behavior.

Read [Schedules](https://docs.blazingagents.com/automation/schedules) and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/tasks), [Python](https://docs.blazingagents.com/sdk/python/tasks), or [REST](https://docs.blazingagents.com/api-reference/rest-api/tasks) references.

## Mistakes and verification

Do not invent a Schedule SDK object or treat “cron job” as a separate entity. Verify next fires with bounded timing, Task-run creation, overlap handling, and schedule changes. Execution state belongs to [Task runs](task-runs.md).
