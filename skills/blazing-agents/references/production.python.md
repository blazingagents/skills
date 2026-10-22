# Take your integration to production: Python code

The Python code for the steps of [Take your integration to production](production.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## One client per credential

```python
from blazing_agents import BlazingAgents, ResponseObservation


def log_response(response: ResponseObservation) -> None:
    print(
        {
            "method": response.method,
            "path": response.path,
            "status": response.status,
            "duration_ms": response.duration_ms,
            "request_id": response.request_id,
        }
    )


client = BlazingAgents(on_response=log_response)
```

## Submit Task runs with an idempotency key

```python
from blazing_agents import BlazingAgents


def submit_daily_report(client: BlazingAgents, task_id: str, day: str) -> str:
    submission = client.tasks.submit(task_id, idempotency_key=f"daily-report:{day}")
    return submission.run_id
```
