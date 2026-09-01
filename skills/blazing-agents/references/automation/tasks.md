# Tasks

A Task is a Tenant-owned named instruction for asynchronous Agent work: a fixed prompt plus an optional schedule. Its execution state lives in Task runs.

## Decision and workflow

1. Use a Task when work should run asynchronously or on a schedule; use direct generation for synchronous output.
2. Create the definition with intended Agent Version and optional timing.
3. Start on demand or let its schedule fire, then observe Task runs.

Read [Tasks](https://docs.blazingagents.com/automation/tasks) and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/tasks), [Python](https://docs.blazingagents.com/sdk/python/tasks), or [REST](https://docs.blazingagents.com/api-reference/rest-api/tasks) references.

## Mistakes and verification

Keep Task definition separate from Task-run state and do not call it a generic job. Verify create/update, on-demand start, Version selection, and resulting run. Run lifecycle belongs to [Task runs](task-runs.md); timing to [Schedules](schedules.md).
