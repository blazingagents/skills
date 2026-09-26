# Show usage to your team or bill your customers

You will build a usage dashboard from one call, drill into usage by user, Agent, or model, and handle the outcomes you get when a quota stops new work.

## When to use this

You want an internal page that shows token and request trends, a per-customer usage view in your product, or numbers to feed your own billing. If you want Blazing Agents to send each user's token usage to your Polar or Dodo account and charge them, read [Bill your users for model tokens](https://docs.blazingagents.com/platform/monetization). To tag Turns with your users first, read [Serve many end users from one account](multi-user-apps.md).

## How it works

Every Turn records input tokens, output tokens, one request, and duration, together with its Agent, model, Session, and Attribution. Failed and canceled Turns are recorded too. `usage.overview()` returns what a dashboard needs in one call: exact totals, one bucket per day, the top Agents, top users, and a model mix. `usage.get()` covers your whole account and `usage.getForAgent()` covers one Agent; both group by one dimension and filter by date, Agent, Session, or `userId`. A quota is an optional monthly ceiling checked before each Turn starts. When it is reached, new chats fail and new Task runs end as `blocked`.

## Build it

1. Load the dashboard with `usage.overview()`. Label the tenant-level user `""` and the model remainder bucket, whose `provider` and `model` are both `null`.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const client = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});

const overview = await client.usage.overview({
  from: "2026-09-01",
  to: "2026-09-26",
  limit: 5,
});

console.log("Requests", overview.totals.requestCount);
console.log("Active Agents", overview.activeAgentCount);
for (const day of overview.daily) {
  console.log(day.day, day.inputTokens + day.outputTokens);
}
for (const row of overview.byAgent) {
  console.log(row.agentId, row.inputTokens + row.outputTokens);
}
for (const row of overview.byUser) {
  console.log(row.userId || "No user", row.inputTokens + row.outputTokens);
}
for (const row of overview.byModel) {
  const label =
    row.provider === null && row.model === null
      ? "Other models"
      : `${row.provider}/${row.model}`;
  console.log(label, row.inputTokens + row.outputTokens);
}
```

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

2. Drill in with `usage.get()` or `usage.getForAgent()`. Group by `user`, `agent`, `model`, `day`, or `session`; `limit` sets how many top Sessions come back when you group by `session`.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const client = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});

const byUser = await client.usage.get({ groupBy: "user" });
for (const bucket of byUser.buckets) {
  console.log(bucket.userId || "No user", bucket.requestCount);
}

const agentModels = await client.usage.getForAgent({
  agentId: "ag_0123456789abcdef",
  groupBy: "model",
});
for (const bucket of agentModels.buckets) {
  console.log(bucket.provider, bucket.model, bucket.outputTokens);
}

const topSessions = await client.usage.getForAgent({
  agentId: "ag_0123456789abcdef",
  groupBy: "session",
  limit: 10,
});
for (const bucket of topSessions.buckets) {
  console.log(bucket.sessionId ?? "Stateless calls", bucket.inputTokens);
}
```

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

3. Show one customer their own usage. Resolve the customer's `userId` from your sign-in on the backend, then filter by it.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const client = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});

export async function customerUsage(signedInUserId: string) {
  const usage = await client.usage.get({
    userId: `app:${signedInUserId}`,
    from: "2026-09-01",
    to: "2026-09-26",
    groupBy: "day",
  });
  return {
    days: usage.buckets.map((bucket) => ({
      day: bucket.day,
      tokens: bucket.inputTokens + bucket.outputTokens,
    })),
    totalTokens: usage.totals.inputTokens + usage.totals.outputTokens,
  };
}
```

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()


def customer_usage(signed_in_user_id: str) -> dict[str, object]:
    usage = client.usage.get(
        user_id=f"app:{signed_in_user_id}",
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

4. Handle quota outcomes. A chat or generation call that starts over the ceiling throws `quota_exceeded`. A Task run that would start over the ceiling ends with status `blocked` instead of `failed`.

```ts
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";

const client = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});

export async function ask(prompt: string): Promise<string> {
  try {
    const result = await client.completion({
      agentId: "ag_0123456789abcdef",
      prompt,
    });
    return await result.text;
  } catch (error) {
    if (BlazingAgentsError.isInstance(error)) {
      if (error.code === "quota_exceeded") return "Monthly limit reached.";
      if (
        error.code === "subscription_required" ||
        error.code === "usage_credit_required"
      ) {
        return "Billing needs attention.";
      }
      if (error.code === "rate_limited") return "Busy, try again shortly.";
    }
    throw error;
  }
}

export async function runStatus(taskId: string, runId: string) {
  const run = await client.tasks.getRun({ taskId, runId });
  return run.status === "blocked" ? "Paused by quota or billing" : run.status;
}
```

```python
from blazing_agents import APIStatusError, BlazingAgents

client = BlazingAgents()


def ask(prompt: str) -> str:
    try:
        return client.completion(agent_id="ag_0123456789abcdef", prompt=prompt)
    except APIStatusError as error:
        if error.code == "quota_exceeded":
            return "Monthly limit reached."
        if error.code in ("subscription_required", "usage_credit_required"):
            return "Billing needs attention."
        if error.code == "rate_limited":
            return "Busy, try again shortly."
        raise


def run_status(task_id: str, run_id: str) -> str:
    run = client.tasks.get_run(task_id, run_id)
    return "Paused by quota or billing" if run.status == "blocked" else run.status
```

## Gotchas

- `byAgent`, `byUser`, and the top models are capped at `limit`. Read totals from `totals` and the Agent count from `activeAgentCount`, not from the length or sum of a ranking.
- The model remainder bucket (`provider` and `model` both `null`) holds every model outside the top list, so `byModel` adds up to `totals`. Render it as "Other models" instead of dropping it.
- `userId: ""` in a bucket is real usage with no user label. `userId: null` means the query was not grouped by user. Show `""` as a row such as "No user".
- `from` and `to` are inclusive UTC dates. Pass both or neither (the default is the last 30 days), and keep the range to 31 days or fewer, or the call fails with `validation_failed`. Page longer periods month by month.
- Usage is summed per day and includes finished Turns only. Treat it as an operational measure, not an invoice. For charging customers, use [monetization](https://docs.blazingagents.com/platform/monetization).
- The quota check runs before a Turn starts, so concurrent Turns can overshoot the ceiling. Alert well before the limit.
- A `blocked` Task run did not execute. Do not retry it in a loop; the next scheduled fire runs normally once the quota allows.
- Keep usage queries on your backend. A customer view must filter by the signed-in user's `userId`, never one sent by the browser.

## Check it works

- Run a chat with `userId: "app:test-user"`, then call `usage.get({ userId: "app:test-user" })`. `totals.requestCount` has grown by one.
- Call `usage.overview()` and add up every `byModel` bucket, including the remainder. The sums match `totals`.
- Call `usage.overview()` with a 7-day range. `daily` has exactly 7 buckets, including days with zero usage.
- Set a very low quota on a test account, then start a chat. Your app shows the `quota_exceeded` message, and a submitted Task run ends as `blocked`.

## Go deeper

- [Usage and quotas](https://docs.blazingagents.com/platform/usage-and-quotas)
- [Usage: TypeScript](https://docs.blazingagents.com/sdk/typescript/usage), [Python](https://docs.blazingagents.com/sdk/python/usage), [REST](https://docs.blazingagents.com/api-reference/rest-api/usage)
- [Task runs](https://docs.blazingagents.com/automation/task-runs)
- [Errors](https://docs.blazingagents.com/api-reference/protocols/errors)
- [Bill your users for model tokens](https://docs.blazingagents.com/platform/monetization)
