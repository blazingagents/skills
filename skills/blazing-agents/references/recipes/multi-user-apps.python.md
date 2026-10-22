# Serve many end users from one account: Python code

The Python code for the steps of [Serve many end users from one account](multi-user-apps.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Derive a scoped client from the session your backend verified

```python
from blazing_agents import BlazingAgents

tenant = BlazingAgents()


def list_my_agents(verified_user_id: str):
    client = tenant.for_user(f"app:{verified_user_id}")
    return client.agents.list(limit=50)
```
