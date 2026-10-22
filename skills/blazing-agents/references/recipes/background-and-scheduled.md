# Run agent work in the background or on a schedule

At the end, your backend saves a Task, starts Task runs on demand or on a clock, and reads each run's result later without keeping a request open.

## When to use this

Use a Task when no one is waiting for the answer: a nightly report, a weekly digest, a long job kicked off by a button, or a cleanup every 15 minutes. If you instead want a live reply streamed to a user, read [Add chat to your app](chat-in-your-app.md).

## How it works

A Task saves an Agent, a fixed `prompt`, and an optional schedule. Each execution is a Task run (`tr_...`) with its own status and a fresh Session, so its transcript holds only that run. You start a run yourself with an idempotency key, or the schedule starts it for you. A run moves from `queued` to `running` and ends as `succeeded`, `failed`, `canceled`, or `blocked`. A Task runs one job at a time. No one can approve a tool call during a run, so the Agent's `approvalInTasks` policy decides what tools may do unattended.

## Build it

For a Python, Rust, or Go backend, read the code for these steps in [Python](background-and-scheduled.python.md), [Rust](background-and-scheduled.rust.md), [Go](background-and-scheduled.go.md).

1. Decide what tools may do without a person. In a Task, a tool call that would need approval (`manual`, or `auto` that asks a person) is denied immediately and the Agent continues with the work it is allowed to do. This example allows only `read`, so the Agent needs `read` in its `tools`. Setting the policy is trusted Tenant configuration, so it runs on the unscoped client.

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

2. Create the Task. When the Task works for one user on that user's own Agent, create it through the user's scoped client, as below. The scope sets the Task's `userId`, and that user's requests can later start, read, change, and cancel its runs through the same scope. When the Agent is shared, a scoped request cannot reach it (`404`), so create the Task on the unscoped client with `userId` for attribution, and check in your backend who may read its runs. Leave out `schedule` for on-demand only, and set `metadata` to tag every run.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
if (!apiKey) throw new Error("Set BLAZING_AGENTS_API_KEY");
const tenant = new BlazingAgents({ apiKey });
declare const verifiedUserId: string; // from your sign-in check
const client = tenant.forUser(verifiedUserId);

const { task } = await client.tasks.create({
  agentId: "ag_0123456789abcdef",
  name: "Morning summary",
  prompt: "Summarize yesterday's support tickets.",
  metadata: { team: "support" },
  schedule: {
    kind: "cron",
    config: { expression: "0 9 * * 1-5", timezone: "Europe/London" },
  },
});
console.log(task.id);
```

Pick the schedule kind that matches the need:

| `kind` | `config` | Runs |
| --- | --- | --- |
| `once` | `{ at: "2026-10-02T09:00:00+01:00" }` (ISO 8601 with offset) | Once at that time |
| `interval` | `{ everyMs: 900000 }` (Python `every_ms`, Go `ba.ScheduleInterval{Every: 15 * time.Minute}`, minimum 60000) | Every N ms from creation |
| `cron` | `{ expression, timezone?, staggerMs? }` (five numeric fields, IANA zone, default `UTC`) | On the calendar |

3. Start a run on demand through the same user's scoped client. Build the idempotency key from a stable business fact so a retried request returns the same run.

```ts
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";

declare const tenant: BlazingAgents;
declare const taskId: string;

export async function startWeeklyReport(verifiedUserId: string, week: string): Promise<string | null> {
  try {
    const { runId } = await tenant.forUser(verifiedUserId).tasks.createRun({
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

Save the `tr_...` run ID with the Task ID, then return from your request.

For a new Task that should run immediately, TypeScript, Rust, and Go can create both in one retry-safe request:

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const tenant: BlazingAgents;
declare const verifiedUserId: string;
declare const agentId: string;
declare const reportDate: string;

const { task, runId } = await tenant.forUser(verifiedUserId).tasks.create({
  agentId,
  name: "Daily report",
  prompt: `Summarize activity for ${reportDate}.`,
  submit: true,
  idempotencyKey: `daily-report:${reportDate}`,
});
console.log(task.id, runId);
```

Keep the key and input stable across retries. Agent and Prompt names are display labels and can repeat; persist resource IDs.

4. Check the run later through the user's scoped client. `runMessages` returns the status and the latest transcript page in one call.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const tenant: BlazingAgents;

export async function waitForRun(verifiedUserId: string, taskId: string, runId: string) {
  const client = tenant.forUser(verifiedUserId);
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

Handle each final status: `succeeded` means the last assistant message is the result. `failed` carries `error`; redact it before logging. `blocked` means a quota or billing check stopped the run before it started; it is not a failure and its transcript may be empty. `canceled` means you stopped it.

5. Find runs the schedule started. List a Task's runs, newest first, or list the user's Tasks with each one's `latestRun` embedded. The scoped list returns only that user's Tasks.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const tenant: BlazingAgents;
declare const verifiedUserId: string;
declare const taskId: string;

const client = tenant.forUser(verifiedUserId);
const { data: runs } = await client.tasks.listRuns({ taskId, limit: 20 });
for (const run of runs) console.log(run.id, run.status, run.finishedAt);

const { data: tasks } = await client.tasks.list();
for (const task of tasks) console.log(task.name, task.latestRun?.status);
```

6. Cancel a run, pause the schedule, or make the Task on-demand only, again through the user's scoped client.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const tenant: BlazingAgents;
declare const verifiedUserId: string;
declare const taskId: string;
declare const runId: string;

const client = tenant.forUser(verifiedUserId);
await client.tasks.cancelRun({ taskId, runId });
await client.tasks.update({ taskId, enabled: false });
await client.tasks.update({ taskId, schedule: null });
const task = await client.tasks.get({ taskId });
console.log(task.nextFireAt);
```

Leaving `schedule` out of an update preserves it. Passing `null` (`.clear_schedule()` in Rust, `ba.Null[ba.Schedule]()` in Go) removes it. Display BA's `nextFireAt` rather than calculating the next time in your app.

Cancel asks the run to stop at its next safe point. Keep polling until a final status; the run may still end as `succeeded`.

## Gotchas

- In TypeScript, pass `idempotencyKey` to `tasks.create()`, including when `submit: true`; in Rust, chain `.submit(true).idempotency_key(...)`; in Go, set `Submit: new(true)` and `IdempotencyKey` together. The same key and original input return the same Task and initial run. Changed input or a deleted Task returns `idempotency_conflict` (409). Without a key, a retry creates another Task. Python currently supports keys on `submit()` only; reconcile Task creation before retrying it.
- A run keeps the `userId`, `metadata`, and Agent configuration (including `approvalInTasks`) captured when it was queued; read it with `getRun()`. Editing the Task or Agent changes later runs only. `agentId` and `userId` cannot change; create a new Task instead.
- Designing a Task around `manual` approval does not work: the call is denied and the run continues without it. Grant the tools it needs with `full` in `approvalInTasks`, or move the step to chat.
- Starting a run with a new key while another run is active returns `task_active_run_exists` (HTTP 409). Scheduled times that fall during an active run are skipped, and missed times are not caught up.
- A run executes at most once. If it ends `failed` partway, tools may already have sent email or written files. Check for those effects before starting it again.
- Derive the scope from verified sign-in as shown in [multi-user apps](multi-user-apps.md). An unscoped Tenant key reaches every Task. A Task created on the unscoped client, even with a `userId`, cannot be run or changed through a scoped client; the call fails with `forbidden` (403). Create a user's Task through their scope from the start.

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
