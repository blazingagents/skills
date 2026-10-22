# Show usage and bill your users: Python code

The Python code for the steps of [Show usage and bill your users](usage-dashboards.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Load the dashboard with `usage.overview()`

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()

overview = client.usage.overview(from_="2026-09-01", to="2026-09-26", limit=5)

print("Requests", overview.totals.request_count)
print("Active Agents", overview.active_agent_count)
for day in overview.daily:
    print(day.day, day.input_tokens + day.output_tokens)
for row in overview.by_agent:
    print(row.agent_id, row.input_tokens + row.output_tokens)
for row in overview.by_user:
    print(row.user_id or "No user", row.input_tokens + row.output_tokens)
for row in overview.by_model:
    label = (
        "Other models"
        if row.provider is None and row.model is None
        else f"{row.provider}/{row.model}"
    )
    print(label, row.input_tokens + row.output_tokens)
```

## Step 2: Drill in with `usage.get()` or `usage.getForAgent()`, still on the unscoped client for internal views

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()

by_user = client.usage.get(group_by="user")
for bucket in by_user.buckets:
    print(bucket.user_id or "No user", bucket.request_count)

agent_models = client.usage.get_for_agent("ag_0123456789abcdef", group_by="model")
for bucket in agent_models.buckets:
    print(bucket.provider, bucket.model, bucket.output_tokens)

top_sessions = client.usage.get_for_agent(
    "ag_0123456789abcdef", group_by="session", limit=10
)
for bucket in top_sessions.buckets:
    print(bucket.session_id or "Stateless calls", bucket.input_tokens)
```

## Step 3: Show one customer their own usage

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()


def customer_usage(signed_in_user_id: str) -> dict[str, object]:
    usage = client.for_user(f"app:{signed_in_user_id}").usage.get(
        from_="2026-09-01",
        to="2026-09-26",
        group_by="day",
    )
    return {
        "days": [
            {"day": b.day, "tokens": b.input_tokens + b.output_tokens}
            for b in usage.buckets
        ],
        "total_tokens": usage.totals.input_tokens + usage.totals.output_tokens,
    }
```

## Step 4: Handle quota and plan outcomes

```python
from blazing_agents import APIStatusError, BlazingAgents

client = BlazingAgents()


def ask(prompt: str, verified_user_id: str) -> str:
    try:
        return client.for_user(verified_user_id).completion(
            agent_id="ag_0123456789abcdef",  # the user's Agent
            prompt=prompt,
        )
    except APIStatusError as error:
        if error.code == "quota_exceeded":
            return "Monthly limit reached."
        if error.code == "model_spending_limit_exceeded":
            return "Spending limit reached. Try again after it resets."
        if error.code in ("subscription_required", "usage_credit_required"):
            return "Your Blazing Agents plan needs attention."
        if error.code in (
            "merchant_subscription_required",
            "merchant_balance_required",
            "merchant_customer_unmapped",
        ):
            return "Upgrade your plan or top up your credits to continue."
        if error.code in ("merchant_eligibility_unavailable", "rate_limited"):
            return "Busy, try again shortly."
        raise


def run_status(verified_user_id: str, task_id: str, run_id: str) -> str:
    run = client.for_user(verified_user_id).tasks.get_run(task_id, run_id)
    return "Paused by quota or billing" if run.status == "blocked" else run.status
```

## Step 5: Connect your Polar or Dodo account, then turn on the billing switch

```python
import os

from blazing_agents import BlazingAgents

client = BlazingAgents()

client.merchant_connection.create(
    provider="polar",
    environment="sandbox",
    credential=os.environ["POLAR_ACCESS_TOKEN"],
)
settings = client.tenant.update(monetization_enabled=True)
print(settings.monetization_enabled)
```

## Step 6: When a user signs up or starts a paid plan, create the customer in your provider, then link your `userId` to it

```python
from blazing_agents import BlazingAgents, MerchantCustomerBinding

client = BlazingAgents()


def link_customer(app_user_id: str, customer_id: str) -> MerchantCustomerBinding:
    return client.merchant_bindings.put(
        f"app:{app_user_id}", customer_id=customer_id
    ).binding
```

## Step 7: Optionally require a paid plan or positive balance before each Turn, and watch delivery

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()

client.merchant_connection.update(
    guard={"enabled": True, "product_ids": ["prod_pro_plan"], "meter_id": None},
)

counts = client.merchant_usage_events.summary(days=7).summary.counts
print(counts.accepted, counts.failed)

for event in client.merchant_usage_events.iter(status="failed"):
    print(event.user_id, event.last_error_code, event.next_action)
    if event.next_action == "retry":
        client.merchant_usage_events.retry(event.id)
```

## Exact usage for a Session list

```python
from blazing_agents import BlazingAgents

tenant = BlazingAgents()


def print_session_usage(verified_user_id: str, session_ids: list[str]) -> None:
    if not session_ids:
        return
    usage = tenant.for_user(verified_user_id).usage.sessions(session_ids)
    for row in usage.data:
        print(row.session_id, row.totals.input_tokens + row.totals.output_tokens)
```
