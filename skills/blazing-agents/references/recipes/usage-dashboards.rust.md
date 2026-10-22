# Show usage and bill your users: Rust code

The Rust code for the steps of [Show usage and bill your users](usage-dashboards.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Load the dashboard with `usage.overview()`

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

## Step 2: Drill in with `usage.get()` or `usage.getForAgent()`, still on the unscoped client for internal views

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

## Step 3: Show one customer their own usage

```rust
use blazing_agents::usage::UsageGroupBy;

let signed_in_user_id = "user_123";
let usage = client
    .for_user(format!("app:{signed_in_user_id}"))?
    .usage()
    .get()
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

## Step 4: Handle quota and plan outcomes

```rust
use blazing_agents::error::ErrorCode;
use blazing_agents::tasks::TaskRunStatus;
use blazing_agents::Error;

let client = client.for_user("app:user-42")?; // the verified signed-in user
let answer = match client
    .completion("ag_0123456789abcdef", "Summarize this ticket.")
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

## Step 5: Connect your Polar or Dodo account, then turn on the billing switch

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

## Step 6: When a user signs up or starts a paid plan, create the customer in your provider, then link your `userId` to it

```rust
let binding = client
    .merchant_bindings()
    .put("app:user_123", "cus_0123456789")
    .await?;
println!("{} {}", binding.user_id, binding.customer_id);
```

## Step 7: Optionally require a paid plan or positive balance before each Turn, and watch delivery

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

## Exact usage for a Session list

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
