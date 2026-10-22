# Run agent work in the background or on a schedule: Python code

The Python code for the steps of [Run agent work in the background or on a schedule](background-and-scheduled.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 2: Create the Task

```python
from blazing_agents import BlazingAgents

tenant = BlazingAgents()  # reads BLAZING_AGENTS_API_KEY
client = tenant.for_user("app:user-42")  # the verified signed-in user

task = client.tasks.create(
    agent_id="ag_0123456789abcdef",
    name="Morning summary",
    prompt="Summarize yesterday's support tickets.",
    metadata={"team": "support"},
    schedule={
        "kind": "cron",
        "config": {"expression": "0 9 * * 1-5", "timezone": "Europe/London"},
    },
).task
print(task.id)
```

## Step 3: Start a run on demand through the same user's scoped client

```python
from blazing_agents import APIStatusError, BlazingAgents


def start_weekly_report(
    client: BlazingAgents, verified_user_id: str, task_id: str, week: str
) -> str | None:
    scoped = client.for_user(verified_user_id)
    try:
        return scoped.tasks.submit(task_id, idempotency_key=f"weekly-report:{week}").run_id
    except APIStatusError as error:
        if error.code == "task_active_run_exists":
            return None
        raise
```

For a new Task that should run immediately:

```python
from blazing_agents import BlazingAgents


def create_daily_report(
    tenant: BlazingAgents, verified_user_id: str, agent_id: str, report_date: str
) -> str | None:
    created = tenant.for_user(verified_user_id).tasks.create(
        agent_id=agent_id,
        name="Daily report",
        prompt=f"Summarize activity for {report_date}.",
        submit=True,
        idempotency_key=f"daily-report:{report_date}",
    )
    return created.run_id
```

## Step 4: Check the run later through the user's scoped client

```python
import time

from blazing_agents import BlazingAgents


def wait_for_run(
    client: BlazingAgents, verified_user_id: str, task_id: str, run_id: str
) -> None:
    scoped = client.for_user(verified_user_id)
    for _ in range(120):
        run = scoped.tasks.run_messages(task_id, run_id)
        if run.status not in ("queued", "running"):
            answer = next((m for m in reversed(run.data) if m.role == "assistant"), None)
            print(run.status, answer.parts if answer else None)
            return
        time.sleep(5)
    raise TimeoutError(f"Run {run_id} did not finish in time")
```

## Step 5: Find runs the schedule started

```python
from blazing_agents import BlazingAgents


def show_runs(client: BlazingAgents, verified_user_id: str, task_id: str) -> None:
    scoped = client.for_user(verified_user_id)
    for run in scoped.tasks.list_runs(task_id, limit=20).data:
        print(run.id, run.status, run.finished_at)
    for task in scoped.tasks.list().data:
        print(task.name, task.latest_run.status if task.latest_run else None)
```

## Step 6: Cancel a run, pause the schedule, or make the Task on-demand only, again through the user's scoped client

```python
from blazing_agents import BlazingAgents


def stop(client: BlazingAgents, verified_user_id: str, task_id: str, run_id: str) -> None:
    scoped = client.for_user(verified_user_id)
    scoped.tasks.cancel_run(task_id, run_id)
    scoped.tasks.update(task_id, enabled=False)
    scoped.tasks.update(task_id, schedule=None)
```
