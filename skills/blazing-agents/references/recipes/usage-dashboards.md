# Show usage and bill your users

You will build a usage dashboard from one call, drill into usage by user, Agent, or model, handle quota outcomes, and charge each of your users for their model tokens through your own Polar or Dodo account.

## When to use this

You want an internal page that shows token and request trends, a per-customer usage view in your product, or to bill your customers for the tokens they use. Steps 1 to 4 cover reporting; steps 5 to 7 cover billing. To tag Turns with your users first, read [Serve many end users from one account](multi-user-apps.md).

## How it works

Every Turn records input tokens, output tokens, one request, and duration, together with its Agent, model, Session, and Attribution. Failed and canceled Turns are recorded too. `usage.overview()` returns what a dashboard needs in one call: exact totals, one bucket per day, the top Agents, top users, and a model mix. `usage.get()` covers your whole account and `usage.getForAgent()` covers one Agent; both group by one dimension and filter by date, Agent, Session, or `userId`. A quota is an optional monthly ceiling checked before each Turn starts. When it is reached, new chat and generation calls fail with `quota_exceeded` and new Task runs end as `blocked`.

Billing is off until you turn on the tenant switch `monetizationEnabled`. Once on, each Turn sends one `ba.model_tokens.v1` usage event to your Polar or Dodo account, tagged with the customer you linked to the Turn's `userId`. Your provider sets prices, allowances, and invoices; Blazing Agents never handles your customers' payments. An optional guard checks the user's plan or balance before each Turn starts. Set billing up from the dashboard or either SDK.

Do not present usage numbers as your Blazing Agents bill. BA charges its own execution and Workspace costs against your plan's usage credit, and those charges can arrive after a Turn finishes.

## Model spending limits

For dollar allowances, use `tenant.getSpendingLimit` and
`tenant.updateSpendingLimit` for the account, or the corresponding
`agents` methods with `agentId`. Python provides `get_spending_limit` and
`update_spending_limit`. Go groups them on `client.SpendingLimits` as
`GetTenant`, `UpdateTenant`, `GetAgent`, and `UpdateAgent`. These operations
require unscoped Tenant authority.

A settings form needs `amountUsd`, `resetStartDate`, and a `resetInterval` of
`daily`, `weekly`, `biweekly`, or `monthly` (snake_case in Python, a `ResetInterval` variant in Rust, a `ba.ResetInterval` constant in Go). Saving
applies immediately and keeps the current period's spend.

Render `period.spentUsd`, `period.availableUsd`, and `nextResetAt` as separate
values, and label the amount as an estimated model-token allowance, not an
invoice total. Each running Turn may finish one model request past the limit,
so `spentUsd` can end slightly above `amountUsd`. In chat,
handle stops as described in [chat in your app](chat-in-your-app.md). Never
automatically retry `model_spending_limit_exceeded` or change a limit the user
did not ask to change.

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

```rust
let overview = client
    .usage()
    .overview()
    .range("2026-09-01", "2026-09-26")
    .limit(5)
    .await?;

println!("Requests {}", overview.totals.request_count);
println!("Active Agents {}", overview.active_agent_count);
for day in &overview.daily {
    println!("{:?} {}", day.day, day.input_tokens + day.output_tokens);
}
for row in &overview.by_agent {
    println!("{:?} {}", row.agent_id, row.input_tokens + row.output_tokens);
}
for row in &overview.by_user {
    println!(
        "{} {}",
        row.user_id.as_deref().unwrap_or("No user"),
        row.input_tokens + row.output_tokens
    );
}
for row in &overview.by_model {
    let label = match (&row.provider, &row.model) {
        (None, None) => "Other models".to_owned(),
        (provider, model) => format!(
            "{}/{}",
            provider.as_deref().unwrap_or(""),
            model.as_deref().unwrap_or("")
        ),
    };
    println!("{label} {}", row.input_tokens + row.output_tokens);
}
```

```go
or := func(p *string, fallback string) string {
	if p == nil || *p == "" {
		return fallback
	}
	return *p
}

overview, err := client.Usage.Overview(ctx, ba.UsageOverviewParams{
	DateRange: &ba.DateRange{
		From: ba.Date{Year: 2026, Month: time.September, Day: 1},
		To:   ba.Date{Year: 2026, Month: time.September, Day: 26},
	},
	Limit: new(5),
})
if err != nil {
	return err
}

fmt.Println("Requests", overview.Totals.RequestCount)
fmt.Println("Active Agents", overview.ActiveAgentCount)
for _, day := range overview.Daily {
	fmt.Println(day.Day, day.InputTokens+day.OutputTokens)
}
for _, row := range overview.ByAgent {
	fmt.Println(row.AgentID, row.InputTokens+row.OutputTokens)
}
for _, row := range overview.ByUser {
	fmt.Println(or(row.UserID, "No user"), row.InputTokens+row.OutputTokens)
}
for _, row := range overview.ByModel {
	label := "Other models"
	if row.Provider != nil || row.Model != nil {
		label = or(row.Provider, "") + "/" + or(row.Model, "")
	}
	fmt.Println(label, row.InputTokens+row.OutputTokens)
}
```

2. Drill in with `usage.get()` or `usage.getForAgent()`. Group by `user`, `agent`, `model`, `day`, or `session`; `limit` (1 to 200, default 50) sets how many top Sessions come back when you group by `session`; other groupings return every group and ignore it.

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

```rust
use blazing_agents::usage::UsageGroupBy;

let by_user = client.usage().get().group_by(UsageGroupBy::User).await?;
for bucket in &by_user.buckets {
    println!(
        "{} {}",
        bucket.user_id.as_deref().unwrap_or("No user"),
        bucket.request_count
    );
}

let agent_models = client
    .usage()
    .get_for_agent("ag_0123456789abcdef")
    .group_by(UsageGroupBy::Model)
    .await?;
for bucket in &agent_models.buckets {
    println!("{:?} {:?} {}", bucket.provider, bucket.model, bucket.output_tokens);
}

let top_sessions = client
    .usage()
    .get_for_agent("ag_0123456789abcdef")
    .group_by(UsageGroupBy::Session)
    .limit(10)
    .await?;
for bucket in &top_sessions.buckets {
    println!(
        "{:?} {}",
        bucket.session_id.as_ref().map(|id| id.as_str()).unwrap_or("Stateless calls"),
        bucket.input_tokens
    );
}
```

```go
or := func(p *string, fallback string) string {
	if p == nil || *p == "" {
		return fallback
	}
	return *p
}

byUser, err := client.Usage.Get(ctx, ba.UsageParams{GroupBy: new(ba.UsageGroupByUser)})
if err != nil {
	return err
}
for _, bucket := range byUser.Buckets {
	fmt.Println(or(bucket.UserID, "No user"), bucket.RequestCount)
}

agentModels, err := client.Usage.ForAgent(ctx, agentID, ba.AgentUsageParams{GroupBy: new(ba.UsageGroupByModel)})
if err != nil {
	return err
}
for _, bucket := range agentModels.Buckets {
	fmt.Println(or(bucket.Provider, ""), or(bucket.Model, ""), bucket.OutputTokens)
}

topSessions, err := client.Usage.ForAgent(ctx, agentID, ba.AgentUsageParams{
	GroupBy: new(ba.UsageGroupBySession),
	Limit:   new(10),
})
if err != nil {
	return err
}
for _, bucket := range topSessions.Buckets {
	label := "Stateless calls"
	if bucket.SessionID != nil {
		label = string(*bucket.SessionID)
	}
	fmt.Println(label, bucket.InputTokens)
}
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

```rust
use blazing_agents::usage::UsageGroupBy;

let signed_in_user_id = "user_123";
let usage = client
    .usage()
    .get()
    .user_id(format!("app:{signed_in_user_id}"))
    .range("2026-09-01", "2026-09-26")
    .group_by(UsageGroupBy::Day)
    .await?;
let days: Vec<_> = usage
    .buckets
    .iter()
    .map(|b| serde_json::json!({"day": b.day, "tokens": b.input_tokens + b.output_tokens}))
    .collect();
let body = serde_json::json!({
    "days": days,
    "total_tokens": usage.totals.input_tokens + usage.totals.output_tokens,
});
```

```go
signedInUserID := "user_123"
usage, err := client.Usage.Get(ctx, ba.UsageParams{
	UserID: new("app:" + signedInUserID),
	DateRange: &ba.DateRange{
		From: ba.Date{Year: 2026, Month: time.September, Day: 1},
		To:   ba.Date{Year: 2026, Month: time.September, Day: 26},
	},
	GroupBy: new(ba.UsageGroupByDay),
})
if err != nil {
	return err
}
type dayUsage struct {
	Day    *string `json:"day"`
	Tokens int64   `json:"tokens"`
}
days := make([]dayUsage, 0, len(usage.Buckets))
for _, bucket := range usage.Buckets {
	days = append(days, dayUsage{Day: bucket.Day, Tokens: bucket.InputTokens + bucket.OutputTokens})
}
body, err := json.Marshal(map[string]any{
	"days":        days,
	"totalTokens": usage.Totals.InputTokens + usage.Totals.OutputTokens,
})
if err != nil {
	return err
}
fmt.Println(string(body))
```

4. Handle quota and plan outcomes. A chat or generation call that starts over the ceiling throws `quota_exceeded`, one stopped by a model spending limit throws `model_spending_limit_exceeded`, and one refused by the billing guard from step 7 throws a `merchant_*` code. A Task run refused before it runs, by the quota, your Blazing Agents plan, the billing guard, or a model spending limit, ends with status `blocked` instead of `failed`. A spending limit that stops a Task run after model work started ends it `failed`.

```ts
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";

const client = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});

export async function ask(prompt: string, userId: string): Promise<string> {
  try {
    const result = await client.completion({
      agentId: "ag_0123456789abcdef",
      prompt,
      userId,
    });
    return await result.text;
  } catch (error) {
    if (BlazingAgentsError.isInstance(error)) {
      switch (error.code) {
        case "quota_exceeded":
          return "Monthly limit reached.";
        case "model_spending_limit_exceeded":
          return "Spending limit reached. Try again after it resets.";
        case "subscription_required":
        case "usage_credit_required":
          return "Your Blazing Agents plan needs attention.";
        case "merchant_subscription_required":
        case "merchant_balance_required":
        case "merchant_customer_unmapped":
          return "Upgrade your plan or top up your credits to continue.";
        case "merchant_eligibility_unavailable":
        case "rate_limited":
          return "Busy, try again shortly.";
      }
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


def ask(prompt: str, user_id: str) -> str:
    try:
        return client.completion(
            agent_id="ag_0123456789abcdef", prompt=prompt, user_id=user_id
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


def run_status(task_id: str, run_id: str) -> str:
    run = client.tasks.get_run(task_id, run_id)
    return "Paused by quota or billing" if run.status == "blocked" else run.status
```

```rust
use blazing_agents::error::ErrorCode;
use blazing_agents::tasks::TaskRunStatus;
use blazing_agents::Error;

let answer = match client
    .completion("ag_0123456789abcdef", "Summarize this ticket.")
    .user_id("app:user-42")
    .await
{
    Ok(text) => text,
    Err(Error::Api(error)) => match error.code() {
        ErrorCode::QuotaExceeded => "Monthly limit reached.".to_owned(),
        ErrorCode::ModelSpendingLimitExceeded => {
            "Spending limit reached. Try again after it resets.".to_owned()
        }
        ErrorCode::SubscriptionRequired | ErrorCode::UsageCreditRequired => {
            "Your Blazing Agents plan needs attention.".to_owned()
        }
        ErrorCode::RateLimited => "Busy, try again shortly.".to_owned(),
        _ => return Err(Error::Api(error).into()),
    },
    Err(error) => return Err(error.into()),
};
println!("{answer}");

let run = client
    .tasks()
    .get_run("tk_0123456789abcdef", "tr_0123456789abcdef")
    .await?;
let status = if run.status == TaskRunStatus::Blocked {
    "Paused by quota or billing".to_owned()
} else {
    run.status.as_str().to_owned()
};
println!("{status}");
```

```go
answer, err := client.Generation.Completion(ctx, agentID, ba.Text("Summarize this ticket."),
	ba.GenerateParams{UserID: new("app:user-42")})
var apiErr *ba.APIError
if errors.As(err, &apiErr) {
	switch apiErr.Code {
	case ba.ErrorCodeQuotaExceeded:
		answer = "Monthly limit reached."
	case ba.ErrorCodeModelSpendingLimitExceeded:
		answer = "Spending limit reached. Try again after it resets."
	case ba.ErrorCodeSubscriptionRequired, ba.ErrorCodeUsageCreditRequired:
		answer = "Your Blazing Agents plan needs attention."
	case ba.ErrorCodeMerchantSubscriptionRequired, ba.ErrorCodeMerchantBalanceRequired, ba.ErrorCodeMerchantCustomerUnmapped:
		answer = "Upgrade your plan or top up your credits to continue."
	case ba.ErrorCodeMerchantEligibilityUnavailable, ba.ErrorCodeRateLimited:
		answer = "Busy, try again shortly."
	default:
		return err
	}
} else if err != nil {
	return err
}
fmt.Println(answer)

run, err := client.Tasks.GetRun(ctx, ba.TaskID("tk_0123456789abcdef"), ba.TaskRunID("tr_0123456789abcdef"))
if err != nil {
	return err
}
status := string(run.Status)
if run.Status == ba.TaskRunStatusBlocked {
	status = "Paused by quota or billing"
}
fmt.Println(status)
```

5. Connect your Polar or Dodo account, then turn on the billing switch. Start in `sandbox`. For Polar, use an Organization Access Token with only `organizations:read`, `customers:read`, and `events:write`; for Dodo, an API key in the matching mode.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const client = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});

await client.merchantConnection.create({
  provider: "polar",
  environment: "sandbox",
  credential: process.env.POLAR_ACCESS_TOKEN ?? "",
});
const settings = await client.tenant.patch({ monetizationEnabled: true });
console.log(settings.monetizationEnabled);
```

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

```rust
use blazing_agents::merchant::{MerchantEnvironment, MerchantProvider};

client
    .merchant_connection()
    .create(
        MerchantProvider::Polar,
        MerchantEnvironment::Sandbox,
        std::env::var("POLAR_ACCESS_TOKEN")?,
    )
    .await?;
let settings = client
    .tenant()
    .update()
    .monetization_enabled(true)
    .await?;
println!("{}", settings.monetization_enabled);
```

```go
_, err := client.MerchantConnection.Create(ctx, ba.CreateMerchantConnectionParams{
	Provider:    ba.MerchantProviderPolar,
	Environment: ba.MerchantEnvironmentSandbox,
	Credential:  ba.NewSecret(os.Getenv("POLAR_ACCESS_TOKEN")),
})
if err != nil {
	return err
}
settings, err := client.Tenant.Update(ctx, ba.UpdateTenantParams{MonetizationEnabled: new(true)})
if err != nil {
	return err
}
fmt.Println(settings.MonetizationEnabled)
```

Then, in your provider, create a meter for events named `ba.model_tokens.v1` that sums `total_tokens` (or `input_tokens` and `output_tokens` for split prices), and attach it to a price or allowance. Events also carry `model`, `agent_id`, `session_id`, and `status` (`succeeded`, `failed`, or `cancelled`) for meter filters.

6. When a user signs up or starts a paid plan, create the customer in your provider, then link your `userId` to it.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const client = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});

export async function linkCustomer(appUserId: string, customerId: string) {
  const { binding } = await client.merchantBindings.put({
    userId: `app:${appUserId}`,
    customerId,
  });
  return binding;
}
```

```python
from blazing_agents import BlazingAgents, MerchantCustomerBinding

client = BlazingAgents()


def link_customer(app_user_id: str, customer_id: str) -> MerchantCustomerBinding:
    return client.merchant_bindings.put(
        f"app:{app_user_id}", customer_id=customer_id
    ).binding
```

```rust
let binding = client
    .merchant_bindings()
    .put("app:user_123", "cus_0123456789")
    .await?;
println!("{} {}", binding.user_id, binding.customer_id);
```

```go
binding, err := client.MerchantBindings.Set(ctx, "app:user_123", ba.SetMerchantBindingParams{CustomerID: "cus_0123456789"})
if err != nil {
	return err
}
fmt.Println(binding.UserID, binding.CustomerID)
```

Use the exact `userId` you pass on chat, generation, and Task calls. Blazing Agents checks that the customer exists in your provider.

7. Optionally require a paid plan or positive balance before each Turn, and watch delivery. Retry `failed` events that BA suggests retrying.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const client = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});

await client.merchantConnection.update({
  guard: { enabled: true, productIds: ["prod_pro_plan"], meterId: null },
});

const { summary } = await client.merchantUsageEvents.summary({ days: 7 });
console.log(summary.counts.accepted, summary.counts.failed);

const { events } = await client.merchantUsageEvents.list({ status: "failed" });
for (const event of events) {
  console.log(event.userId, event.lastErrorCode, event.nextAction);
  if (event.nextAction === "retry") {
    await client.merchantUsageEvents.retry({ eventId: event.id });
  }
}
```

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

```rust
use blazing_agents::merchant::{MerchantGuard, MerchantNextAction, MerchantUsageEventStatus};
use futures_util::TryStreamExt;

client
    .merchant_connection()
    .update()
    .guard(MerchantGuard::new(true).product_ids(["prod_pro_plan"]))
    .await?;

let counts = client.merchant_usage_events().summary().days(7).await?.counts;
println!("{} {}", counts.accepted, counts.failed);

let mut events = client
    .merchant_usage_events()
    .list()
    .status(MerchantUsageEventStatus::Failed)
    .items();
while let Some(event) = events.try_next().await? {
    println!("{} {:?} {:?}", event.user_id, event.last_error_code, event.next_action);
    if event.next_action == MerchantNextAction::Retry {
        client.merchant_usage_events().retry(event.id).await?;
    }
}
```

```go
_, err := client.MerchantConnection.Update(ctx, ba.UpdateMerchantConnectionParams{
	Guard: &ba.MerchantGuard{Enabled: true, ProductIDs: []string{"prod_pro_plan"}},
})
if err != nil {
	return err
}

summary, err := client.MerchantUsageEvents.Summary(ctx, ba.MerchantUsageSummaryParams{Days: new(7)})
if err != nil {
	return err
}
fmt.Println(summary.Counts.Accepted, summary.Counts.Failed)

failed := ba.ListMerchantUsageEventsParams{Status: new(ba.MerchantUsageEventStatusFailed)}
for event, err := range client.MerchantUsageEvents.All(ctx, failed) {
	if err != nil {
		return err
	}
	fmt.Println(event.UserID, event.NextAction)
	if event.NextAction == ba.MerchantUsageEventActionRetry {
		if _, err := client.MerchantUsageEvents.Retry(ctx, event.ID); err != nil {
			return err
		}
	}
}
```

`productIds` requires an active subscription to one of those products; `meterId` (a Polar meter or a Dodo credit entitlement) requires a balance above zero; set both to require both. Each event has a suggested `nextAction` such as `retry` or `discard`. A retry is safe because your provider drops duplicates by the event ID.

Link each user in step 6 before their first Turn. A Turn whose user has no linked customer records its event once as `discarded`, with `lastErrorCode` `MERCHANT_CUSTOMER_UNMAPPED`, and that usage is never billed, even after you link the user. To refuse such a Turn instead, turn on the guard: the Turn then fails with `merchant_customer_unmapped`.

## Exact usage for a Session list

Use `usage.sessions()` when the UI already has Session IDs. `usage.get({ groupBy: "session" })` returns a ranked, limited set, so an omitted Session is not evidence of zero usage.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const tenant: BlazingAgents;
declare const verifiedUserId: string;
declare const sessionIds: string[];

const client = tenant.forUser(verifiedUserId);
if (sessionIds.length > 0) {
  const usage = await client.usage.sessions({ sessionIds });
  for (const { sessionId, totals } of usage.data) {
    console.log(sessionId, totals.inputTokens + totals.outputTokens);
  }
}
```

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

```rust
let verified_user_id = "user_123";
let session_ids = ["ss_0123456789abcdef"];
if !session_ids.is_empty() {
    let usage = client
        .for_user(verified_user_id)?
        .usage()
        .sessions(session_ids)
        .await?;
    for row in &usage.data {
        println!(
            "{} {}",
            row.session_id,
            row.totals.input_tokens + row.totals.output_tokens
        );
    }
}
```

```go
verifiedUserID := "user_123"
sessionIDs := []ba.SessionID{sessionID}
if len(sessionIDs) > 0 {
	scoped, err := client.ForUser(verifiedUserID)
	if err != nil {
		return err
	}
	usage, err := scoped.Usage.Sessions(ctx, ba.SessionUsageParams{SessionIDs: sessionIDs})
	if err != nil {
		return err
	}
	for _, row := range usage.Data {
		fmt.Println(row.SessionID, row.Totals.InputTokens+row.Totals.OutputTokens)
	}
}
```

Send 1 to 100 distinct IDs per request. The response preserves their order and returns zero totals for visible Sessions with no usage in the requested period. A missing or inaccessible Session makes the whole request fail with 404. Both dates are optional together; without them the range is the last 30 days.

## Gotchas

- In `usage.overview()`, `byAgent`, `byUser`, and the top models are capped at `limit` (1 to 20, default 5). Read totals from `totals` and the Agent count from `activeAgentCount`, not from a ranking. Render the model remainder bucket as "Other models" instead of dropping it, or `byModel` no longer adds up to `totals`.
- `userId: ""` in a bucket is real usage with no user label. `userId: null` means the query was not grouped by user. Show `""` as a row such as "No user".
- `from` and `to` are inclusive UTC dates. Pass both or neither (the default is the last 30 days), and keep the range to 31 days or fewer, or the call fails with `validation_failed`. Page longer periods month by month.
- Usage from `client.usage` is summed per day and includes finished Turns only. Show it to people, but charge customers from the events your provider receives, not from these numbers.
- The quota and guard checks run before a Turn starts, so concurrent or long Turns can overshoot a ceiling or balance. Alert well before the limit.
- A `blocked` Task run did not execute. Do not retry it in a loop; the next scheduled fire runs normally once the quota allows.
- `subscription_required` and `usage_credit_required` are about your own Blazing Agents plan. `merchant_*` codes are about your end user's plan in your provider. Show them different messages.
- A Turn with no `userId`, or a `userId` you never linked, records its event as `discarded` with `lastErrorCode` `MERCHANT_CUSTOMER_UNMAPPED`, and that usage is never billed. Link the user in step 6 before their first Turn, or turn on the guard so such a Turn fails with `merchant_customer_unmapped`.
- Turning `monetizationEnabled` off discards every event your provider has not accepted yet, and turning it back on does not backfill them.
- Keep usage queries and billing calls on your backend. A customer view must filter by the signed-in user's `userId`, never one sent by the browser.

## Check it works

- Run a chat with `userId: "app:test-user"`, then call `usage.get({ userId: "app:test-user" })`. `totals.requestCount` has grown by one.
- Call `usage.overview()` and add up every `byModel` bucket, including the remainder. The sums match `totals`.
- Call `usage.overview()` with a 7-day range. `daily` has exactly 7 buckets, including days with zero usage.
- Set a very low quota on a test account, then start a chat. Your app shows the `quota_exceeded` message, and a submitted Task run ends as `blocked`.
- With a sandbox connection, link a test user and run one chat as them. `merchantUsageEvents.list()` shows an `accepted` event with the Turn's tokens, and the event appears on the customer in your provider.
- Run a chat as a user you never linked. Its event is `discarded` with `lastErrorCode` `MERCHANT_CUSTOMER_UNMAPPED`.

## Go deeper

- [Usage and quotas](https://docs.blazingagents.com/platform/usage-and-quotas)
- [Bill your users for model tokens](https://docs.blazingagents.com/platform/monetization)
- [Usage: TypeScript](https://docs.blazingagents.com/sdk/typescript/usage), [Python](https://docs.blazingagents.com/sdk/python/usage), [REST](https://docs.blazingagents.com/api-reference/rest-api/usage)
- [Tenant settings: TypeScript](https://docs.blazingagents.com/sdk/typescript/tenant)
- [Monetization REST reference](https://docs.blazingagents.com/api-reference/rest-api/merchant)
- [Task runs](https://docs.blazingagents.com/automation/task-runs)
- [Errors](https://docs.blazingagents.com/api-reference/protocols/errors)
