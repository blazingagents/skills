# Run agent work in the background or on a schedule

At the end, your backend saves a Task, starts Task runs on demand or on a clock, and reads each run's result later without keeping a request open.

## When to use this

Use a Task when no one is waiting for the answer: a nightly report, a weekly digest, a long job kicked off by a button, or a cleanup every 15 minutes. If you instead want a live reply streamed to a user, read [Add chat to your app](chat-in-your-app.md).

## How it works

A Task saves an Agent, a fixed `prompt`, and an optional schedule. Each execution is a Task run (`tr_...`) with its own status and a fresh Session, so its transcript holds only that run. You start a run yourself with an idempotency key, or the schedule starts it for you. A run moves `queued` → `running` and ends as `succeeded`, `failed`, `canceled`, or `blocked`. A Task runs one job at a time. No one can approve a tool call during a run, so the Agent's `approvalInTasks` policy decides what tools may do unattended.

## Build it

1. Decide what tools may do without a person. In a Task, a tool call that would need approval (`manual`, or `auto` that asks a person) is denied immediately and the Agent continues with the work it is allowed to do. This example allows only `read`, so the Agent needs the `workspace` tool group. Each update saves a new Agent Version.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const agentId: string;

await client.agents.update({
  agentId,
  approvalInTasks: {
    default: "deny",
    overrides: [{ tool: { type: "builtin", name: "read" }, decision: "full" }],
  },
});
```

2. Create the Task. Leave out `schedule` for on-demand only. Set `userId` and `metadata` to attribute every run to one of your users.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
if (!apiKey) throw new Error("Set BLAZING_AGENTS_API_KEY");
const client = new BlazingAgents({ apiKey });

const { task } = await client.tasks.create({
  agentId: "ag_0123456789abcdef",
  name: "Morning summary",
  prompt: "Summarize yesterday's support tickets.",
  agentVersion: 3,
  userId: "app:user-42",
  metadata: { team: "support" },
  schedule: {
    kind: "cron",
    config: { expression: "0 9 * * 1-5", timezone: "Europe/London" },
  },
});
console.log(task.id);
```

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()  # reads BLAZING_AGENTS_API_KEY

task = client.tasks.create(
    agent_id="ag_0123456789abcdef",
    name="Morning summary",
    prompt="Summarize yesterday's support tickets.",
    agent_version=3,
    user_id="app:user-42",
    metadata={"team": "support"},
    schedule={
        "kind": "cron",
        "config": {"expression": "0 9 * * 1-5", "timezone": "Europe/London"},
    },
).task
print(task.id)
```

Pick the schedule kind that matches the need:

| `kind` | `config` | Runs |
| --- | --- | --- |
| `once` | `{ at: "2026-10-02T09:00:00+01:00" }` (ISO 8601 with offset) | Once at that time |
| `interval` | `{ everyMs: 900000 }` (Python `every_ms`, minimum 60000) | Every N ms from creation |
| `cron` | `{ expression, timezone?, staggerMs? }` (five numeric fields, IANA zone, default `UTC`) | On the calendar |

Omit `agentVersion` to use the Agent's latest configuration at the moment each run is queued. Pin it to keep runs on a known-good Version.

3. Start a run on demand. Build the idempotency key from a stable business fact so a retried request returns the same run.

```ts
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const taskId: string;

export async function startWeeklyReport(week: string): Promise<string | null> {
  try {
    const { runId } = await client.tasks.createRun({
      taskId,
      idempotencyKey: `weekly-report:${week}`,
    });
    return runId;
  } catch (error) {
    if (error instanceof BlazingAgentsError && error.code === "task_active_run_exists") {
      return null;
    }
    throw error;
  }
}
```

```python
from blazing_agents import APIStatusError, BlazingAgents


def start_weekly_report(client: BlazingAgents, task_id: str, week: str) -> str | None:
    try:
        return client.tasks.submit(task_id, idempotency_key=f"weekly-report:{week}").run_id
    except APIStatusError as error:
        if error.code == "task_active_run_exists":
            return None
        raise
```

Save the `tr_...` run ID with the Task ID, then return from your request.

4. Check the run later. `runMessages` returns the status and the latest transcript page in one call.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;

export async function waitForRun(taskId: string, runId: string) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const run = await client.tasks.runMessages({ taskId, runId });
    if (run.status !== "queued" && run.status !== "running") {
      const answer = run.data.filter((m) => m.role === "assistant").at(-1);
      return { status: run.status, error: run.error, parts: answer?.parts ?? [] };
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Run ${runId} did not finish in time`);
}
```

```python
import time

from blazing_agents import BlazingAgents


def wait_for_run(client: BlazingAgents, task_id: str, run_id: str) -> None:
    for _ in range(120):
        run = client.tasks.run_messages(task_id, run_id)
        if run.status not in ("queued", "running"):
            answer = next((m for m in reversed(run.data) if m.role == "assistant"), None)
            print(run.status, answer.parts if answer else None)
            return
        time.sleep(5)
    raise TimeoutError(f"Run {run_id} did not finish in time")
```

Handle each final status: `succeeded` means the last assistant message is the result. `failed` carries `error`; redact it before logging. `blocked` means a quota, subscription, or usage credit check stopped the run before it started; it is not a failure and its transcript may be empty. `canceled` means you stopped it.

5. Find runs the schedule started. List a Task's runs, newest first, or list Tasks with each one's `latestRun` embedded.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const taskId: string;

const { data: runs } = await client.tasks.listRuns({ taskId, limit: 20 });
for (const run of runs) console.log(run.id, run.status, run.finishedAt);

const { data: tasks } = await client.tasks.list({ userId: "app:user-42" });
for (const task of tasks) console.log(task.name, task.latestRun?.status);
```

```python
from blazing_agents import BlazingAgents


def show_runs(client: BlazingAgents, task_id: str) -> None:
    for run in client.tasks.list_runs(task_id, limit=20).data:
        print(run.id, run.status, run.finished_at)
    for task in client.tasks.list(user_id="app:user-42").data:
        print(task.name, task.latest_run.status if task.latest_run else None)
```

6. Cancel a run, pause the schedule, or make the Task on-demand only.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const taskId: string;
declare const runId: string;

await client.tasks.cancelRun({ taskId, runId });
await client.tasks.update({ taskId, enabled: false });
await client.tasks.update({ taskId, schedule: null });
```

```python
from blazing_agents import BlazingAgents


def stop(client: BlazingAgents, task_id: str, run_id: str) -> None:
    client.tasks.cancel_run(task_id, run_id)
    client.tasks.update(task_id, enabled=False)
    client.tasks.update(task_id, schedule=None)
```

Cancel asks the run to stop at its next safe point. Keep polling until a final status; the run may still end as `succeeded`.

## Gotchas

- `tasks.create({ submit: true })` starts a run with no idempotency key, so a retry creates a second Task and run. Create the Task first, then call `createRun` with a key.
- A run keeps the `userId`, `metadata`, and Version captured when it was queued. Editing the Task changes future runs only. `agentId` and `userId` cannot change; create a new Task instead.
- A Task pinned with `agentVersion` keeps that Version's `approvalInTasks`. After you change the policy, update the pin to the new Version.
- Designing a Task around `manual` approval does not work: the call is denied at once, and a run that still ends up waiting for a person fails. Grant the tools it needs with `full` in `approvalInTasks`, or move the step to chat.
- Starting a run with a new key while another run is active returns `task_active_run_exists` (HTTP 409). Scheduled times that fall during an active run are skipped, and missed times are not caught up.
- A run executes at most once. If it ends `failed` partway, tools may already have sent email or written files. Check for those effects before starting it again.
- Your Tenant key reaches every Task. Check in your backend that the current user may read or run a Task before passing its ID.

## Check it works

- Call your start function twice with the same key; both calls return the same `tr_...` ID.
- Poll that run; it reaches `succeeded` and the last assistant message answers the Task prompt.
- Create a Task with `{ kind: "interval", config: { everyMs: 60000 } }`; within two minutes `listRuns` shows a new run.
- Read the run with `getRun`; its `userId` and `metadata` match the Task, and `agentVersion` matches your pin.
- Cancel a long run; polling ends at `canceled` or `succeeded`.

## Go deeper

- [Tasks](https://docs.blazingagents.com/automation/tasks), [Task runs](https://docs.blazingagents.com/automation/task-runs), [Schedules](https://docs.blazingagents.com/automation/schedules)
- [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals) for `approvalInTasks`
- [Limits and reliability](https://docs.blazingagents.com/platform/limits-and-reliability) and [Usage and quotas](https://docs.blazingagents.com/platform/usage-and-quotas) for retries and `blocked` runs
- [Tenancy and end-user attribution](https://docs.blazingagents.com/platform/tenancy-and-attribution)
- SDK reference: [TypeScript](https://docs.blazingagents.com/sdk/typescript/tasks), [Python](https://docs.blazingagents.com/sdk/python/tasks)
