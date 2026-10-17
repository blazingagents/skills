# Run agent work in the background or on a schedule

At the end, your backend saves a Task, starts Task runs on demand or on a clock, and reads each run's result later without keeping a request open.

## When to use this

Use a Task when no one is waiting for the answer: a nightly report, a weekly digest, a long job kicked off by a button, or a cleanup every 15 minutes. If you instead want a live reply streamed to a user, read [Add chat to your app](chat-in-your-app.md).

## How it works

A Task saves an Agent, a fixed `prompt`, and an optional schedule. Each execution is a Task run (`tr_...`) with its own status and a fresh Session, so its transcript holds only that run. You start a run yourself with an idempotency key, or the schedule starts it for you. A run moves from `queued` to `running` and ends as `succeeded`, `failed`, `canceled`, or `blocked`. A Task runs one job at a time. No one can approve a tool call during a run, so the Agent's `approvalInTasks` policy decides what tools may do unattended.

## Build it

1. Decide what tools may do without a person. In a Task, a tool call that would need approval (`manual`, or `auto` that asks a person) is denied immediately and the Agent continues with the work it is allowed to do. This example allows only `read`, so the Agent needs `read` in its `tools`.

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
    user_id="app:user-42",
    metadata={"team": "support"},
    schedule={
        "kind": "cron",
        "config": {"expression": "0 9 * * 1-5", "timezone": "Europe/London"},
    },
).task
print(task.id)
```

```rust
use blazing_agents::tasks::Schedule;
use blazing_agents::types::Metadata;

let created = client
    .tasks()
    .create(
        "ag_0123456789abcdef",
        "Morning summary",
        "Summarize yesterday's support tickets.",
    )
    .user_id("app:user-42")
    .metadata(Metadata::new().insert("team", "support"))
    .schedule(Schedule::cron("0 9 * * 1-5").timezone("Europe/London"))
    .await?;
println!("{}", created.task.id);
```

```go
created, err := client.Tasks.Create(ctx, ba.CreateTaskParams{
	AgentID:  agentID,
	Name:     "Morning summary",
	Prompt:   "Summarize yesterday's support tickets.",
	UserID:   new("app:user-42"),
	Metadata: ba.Metadata{"team": "support"},
	Schedule: ba.Value[ba.Schedule](ba.ScheduleCron{Expression: "0 9 * * 1-5", Timezone: new("Europe/London")}),
})
if err != nil {
	return err
}
fmt.Println(created.Task.ID)
```

Pick the schedule kind that matches the need:

| `kind` | `config` | Runs |
| --- | --- | --- |
| `once` | `{ at: "2026-10-02T09:00:00+01:00" }` (ISO 8601 with offset) | Once at that time |
| `interval` | `{ everyMs: 900000 }` (Python `every_ms`, Go `ba.ScheduleInterval{Every: 15 * time.Minute}`, minimum 60000) | Every N ms from creation |
| `cron` | `{ expression, timezone?, staggerMs? }` (five numeric fields, IANA zone, default `UTC`) | On the calendar |

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
    if (BlazingAgentsError.isInstance(error) && error.code === "task_active_run_exists") {
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

```rust
use blazing_agents::error::ErrorCode;
use blazing_agents::Error;

let week = "2026-W41";
let run_id = match client
    .tasks()
    .submit("tk_0123456789abcdef")
    .idempotency_key(format!("weekly-report:{week}"))
    .await
{
    Ok(created) => Some(created.run_id),
    Err(Error::Api(error)) if error.code() == &ErrorCode::TaskActiveRunExists => None,
    Err(error) => return Err(error.into()),
};
println!("{run_id:?}");
```

```go
week := "2026-W41"
created, err := client.Tasks.Submit(ctx, ba.TaskID("tk_0123456789abcdef"), ba.SubmitTaskParams{
	IdempotencyKey: new("weekly-report:" + week),
})
var apiErr *ba.APIError
switch {
case errors.As(err, &apiErr) && apiErr.Code == ba.ErrorCodeTaskActiveRunExists:
	fmt.Println("a run is already active")
case err != nil:
	return err
default:
	fmt.Println(created.RunID)
}
```

Save the `tr_...` run ID with the Task ID, then return from your request.

For a new Task that should run immediately, TypeScript, Rust, and Go can create both in one retry-safe request:

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const verifiedUserId: string;
declare const agentId: string;
declare const reportDate: string;

const { task, runId } = await client.forUser(verifiedUserId).tasks.create({
  agentId,
  name: "Daily report",
  prompt: `Summarize activity for ${reportDate}.`,
  submit: true,
  idempotencyKey: `daily-report:${reportDate}`,
});
console.log(task.id, runId);
```

```rust
let report_date = "2026-10-02";
let created = client
    .for_user("app:user-42")?
    .tasks()
    .create(
        "ag_0123456789abcdef",
        "Daily report",
        &format!("Summarize activity for {report_date}."),
    )
    .submit(true)
    .idempotency_key(format!("daily-report:{report_date}"))
    .await?;
println!("{} {:?}", created.task.id, created.run_id);
```

```go
reportDate := "2026-10-02"
scoped, err := client.ForUser("app:user-42")
if err != nil {
	return err
}
created, err := scoped.Tasks.Create(ctx, ba.CreateTaskParams{
	AgentID:        agentID,
	Name:           "Daily report",
	Prompt:         "Summarize activity for " + reportDate + ".",
	Submit:         new(true),
	IdempotencyKey: new("daily-report:" + reportDate),
})
if err != nil {
	return err
}
fmt.Println(created.Task.ID)
if created.RunID != nil {
	fmt.Println(*created.RunID)
}
```

Keep the key and input stable across retries. Agent and Prompt names are display labels and can repeat; persist resource IDs.

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

```rust
use blazing_agents::tasks::TaskRunStatus;

for _ in 0..120 {
    let run = client
        .tasks()
        .run_messages("tk_0123456789abcdef", "tr_0123456789abcdef")
        .await?;
    if !matches!(run.status, TaskRunStatus::Queued | TaskRunStatus::Running) {
        println!("{} {:?}", run.status.as_str(), run.error);
        return Ok(());
    }
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
}
return Err("Run tr_0123456789abcdef did not finish in time".into());
```

```go
taskID, runID := ba.TaskID("tk_0123456789abcdef"), ba.TaskRunID("tr_0123456789abcdef")
for range 120 {
	run, err := client.Tasks.ListRunMessages(ctx, taskID, runID, ba.ListTaskRunMessagesParams{})
	if err != nil {
		return err
	}
	if run.Status != ba.TaskRunStatusQueued && run.Status != ba.TaskRunStatusRunning {
		fmt.Println(run.Status)
		if run.Error != nil {
			fmt.Println(*run.Error) // redact before logging
		}
		return nil
	}
	time.Sleep(5 * time.Second)
}
return fmt.Errorf("run %s did not finish in time", runID)
```

Handle each final status: `succeeded` means the last assistant message is the result. `failed` carries `error`; redact it before logging. `blocked` means a quota or billing check stopped the run before it started; it is not a failure and its transcript may be empty. `canceled` means you stopped it.

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

```rust
let runs = client
    .tasks()
    .list_runs("tk_0123456789abcdef")
    .limit(20)
    .await?;
for run in &runs.data {
    println!("{} {} {:?}", run.id, run.status.as_str(), run.finished_at);
}

let tasks = client.tasks().list().user_id("app:user-42").await?;
for task in &tasks.data {
    println!(
        "{} {:?}",
        task.name,
        task.latest_run.as_ref().map(|run| run.status.as_str())
    );
}
```

```go
taskID := ba.TaskID("tk_0123456789abcdef")
runs, err := client.Tasks.ListRuns(ctx, taskID, ba.ListTaskRunsParams{Limit: new(20)})
if err != nil {
	return err
}
for _, run := range runs.Data {
	fmt.Println(run.ID, run.Status, run.FinishedAt)
}

tasks, err := client.Tasks.List(ctx, ba.ListTasksParams{UserID: new("app:user-42")})
if err != nil {
	return err
}
for _, task := range tasks.Data {
	if task.LatestRun != nil {
		fmt.Println(task.Name, task.LatestRun.Status)
	}
}
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
const task = await client.tasks.get({ taskId });
console.log(task.nextFireAt);
```

```python
from blazing_agents import BlazingAgents


def stop(client: BlazingAgents, task_id: str, run_id: str) -> None:
    client.tasks.cancel_run(task_id, run_id)
    client.tasks.update(task_id, enabled=False)
    client.tasks.update(task_id, schedule=None)
```

```rust
client
    .tasks()
    .cancel_run("tk_0123456789abcdef", "tr_0123456789abcdef")
    .await?;
client
    .tasks()
    .update("tk_0123456789abcdef")
    .enabled(false)
    .await?;
client
    .tasks()
    .update("tk_0123456789abcdef")
    .clear_schedule()
    .await?;
```

```go
taskID := ba.TaskID("tk_0123456789abcdef")
if err := client.Tasks.CancelRun(ctx, taskID, ba.TaskRunID("tr_0123456789abcdef")); err != nil {
	return err
}
if _, err := client.Tasks.Update(ctx, taskID, ba.UpdateTaskParams{Enabled: new(false)}); err != nil {
	return err
}
task, err := client.Tasks.Update(ctx, taskID, ba.UpdateTaskParams{Schedule: ba.Null[ba.Schedule]()})
if err != nil {
	return err
}
fmt.Println(task.NextFireAt)
```

Leaving `schedule` out of an update preserves it. Passing `null` (`.clear_schedule()` in Rust, `ba.Null[ba.Schedule]()` in Go) removes it. Display BA's `nextFireAt` rather than calculating the next time in your app.

Cancel asks the run to stop at its next safe point. Keep polling until a final status; the run may still end as `succeeded`.

## Gotchas

- In TypeScript, pass `idempotencyKey` to `tasks.create()`, including when `submit: true`; in Rust, chain `.submit(true).idempotency_key(...)`; in Go, set `Submit: new(true)` and `IdempotencyKey` together. The same key and original input return the same Task and initial run. Changed input or a deleted Task returns `idempotency_conflict` (409). Without a key, a retry creates another Task. Python currently supports keys on `submit()` only; reconcile Task creation before retrying it.
- A run keeps the `userId`, `metadata`, and Agent configuration (including `approvalInTasks`) captured when it was queued; read it with `getRun()`. Editing the Task or Agent changes later runs only. `agentId` and `userId` cannot change; create a new Task instead.
- Designing a Task around `manual` approval does not work: the call is denied and the run continues without it. Grant the tools it needs with `full` in `approvalInTasks`, or move the step to chat.
- Starting a run with a new key while another run is active returns `task_active_run_exists` (HTTP 409). Scheduled times that fall during an active run are skipped, and missed times are not caught up.
- A run executes at most once. If it ends `failed` partway, tools may already have sent email or written files. Check for those effects before starting it again.
- For an end-user request, derive a scoped client or header from verified sign-in as shown in [multi-user apps](multi-user-apps.md). An unscoped Tenant key reaches every Task.

## Check it works

- Call keyed `tasks.create()` twice with the same input; both calls return the same Task and initial run IDs. Change the input under that key and expect `idempotency_conflict`.
- Call your start function twice with the same key; both calls return the same `tr_...` ID.
- Poll that run; it reaches `succeeded` and the last assistant message answers the Task prompt.
- Create a Task with `{ kind: "interval", config: { everyMs: 60000 } }`; within two minutes `listRuns` shows a new run.
- Read the run with `getRun`; its `userId` and `metadata` match the Task, and `agentConfig` shows the saved model, instructions, and approval policies.
- Cancel a long run; polling ends at `canceled` or `succeeded`.

## Go deeper

- [Tasks](https://docs.blazingagents.com/automation/tasks), [Task runs](https://docs.blazingagents.com/automation/task-runs), [Schedules](https://docs.blazingagents.com/automation/schedules)
- [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals) for `approvalInTasks`
- [Limits and reliability](https://docs.blazingagents.com/platform/limits-and-reliability) and [Usage and quotas](https://docs.blazingagents.com/platform/usage-and-quotas) for retries and `blocked` runs
- [Tenancy and end-user attribution](https://docs.blazingagents.com/platform/tenancy-and-attribution)
- SDK reference: [TypeScript](https://docs.blazingagents.com/sdk/typescript/tasks), [Python](https://docs.blazingagents.com/sdk/python/tasks)
