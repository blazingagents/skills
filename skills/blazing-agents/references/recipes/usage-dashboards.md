# Show usage and bill your users

You will build a usage dashboard from one call, drill into usage by user, Agent, or model, handle limit outcomes, and charge each of your users for their model tokens through your own Polar or Dodo account.

## When to use this

You want an internal page that shows token and request trends, a per-customer usage view in your product, or to bill your customers for the tokens they use. Steps 1 to 4 cover reporting; steps 5 to 7 cover billing. To tag Turns with your users first, read [Serve many end users from one account](multi-user-apps.md).

## How it works

Every Turn records input tokens, output tokens, one request, and duration, together with its Agent, model, Session, and Attribution. Failed and canceled Turns are recorded too. `usage.overview()` returns what a dashboard needs in one call: exact totals, one bucket per day, the top Agents, top users, and a model mix. `usage.get()` covers your whole account and `usage.getForAgent()` covers one Agent; both group by one dimension and filter by date, Agent, Session, or `userId`. A model spending limit is an optional dollar allowance checked before each model request. When it is spent, new chat and generation calls fail with `model_spending_limit_exceeded` and new Task runs end as `blocked`.

Billing is off until you turn on the tenant switch `monetizationEnabled`. Once on, each Turn sends one `ba.model_tokens.v1` usage event to your Polar or Dodo account, tagged with the customer you linked to the Turn's `userId`. Your provider sets prices, allowances, and invoices; Blazing Agents never handles your customers' payments. An optional guard checks the user's plan or balance before each Turn starts. Set billing up from the dashboard or either SDK.

Do not present usage numbers as your Blazing Agents bill. BA charges its own execution and Workspace costs against your plan's usage credit, and those charges can arrive after a Turn finishes.

## Model spending limits

For dollar allowances, use `tenant.getSpendingLimit` and
`tenant.updateSpendingLimit` for the account, or the corresponding
`agents` methods with `agentId` (each SDK page gives its spelling). These
operations require unscoped Tenant authority.

A settings form needs `amountUsd`, `resetStartDate`, and a `resetInterval` of
`daily`, `weekly`, `biweekly`, or `monthly`. Saving
applies immediately and keeps the current period's spend.

Render `period.spentUsd`, `period.availableUsd`, and `nextResetAt` as separate
values, and label the amount as an estimated model-token allowance, not an
invoice total. Each running Turn may finish one model request past the limit,
so `spentUsd` can end slightly above `amountUsd`. While a limit applies, a model
with no known price is refused as `unpriced` before any request, and a response that reports no
cost stops the Turn the same way; custom Providers and bring-your-own-key
responses without an upstream cost hit this, so test a limit with the exact
Provider and model first. Web search is billed as Usage credit and is not
capped by spending limits. In chat,
handle stops as described in [chat in your app](chat-in-your-app.md). Never
automatically retry `model_spending_limit_exceeded` or change a limit the user
did not ask to change.

## Build it

For a Python, Rust, or Go backend, read the code for these steps in [Python](usage-dashboards.python.md), [Rust](usage-dashboards.rust.md), [Go](usage-dashboards.go.md).

1. Load the dashboard with `usage.overview()`. It covers every user, so it is a trusted Tenant operation on the unscoped client, for your internal page only. Label the tenant-level user `""` and the model remainder bucket, whose `provider` and `model` are both `null`.

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

2. Drill in with `usage.get()` or `usage.getForAgent()`, still on the unscoped client for internal views. Group by `user`, `agent`, `model`, `day`, or `session`; `limit` (1 to 200, default 50) sets how many top Sessions come back when you group by `session`; other groupings return every group and ignore it.

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

3. Show one customer their own usage. Resolve the customer's ID from your sign-in on the backend and query through their End-user scoped client. The scope limits the result to that user's usage, so the call needs no `userId` filter.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const tenant = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});

export async function customerUsage(signedInUserId: string) {
  const usage = await tenant.forUser(`app:${signedInUserId}`).usage.get({
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

4. Handle limit and plan outcomes. A chat or generation call stopped by a model spending limit throws `model_spending_limit_exceeded`, and one refused by the billing guard from step 7 throws a `merchant_*` code. A Task run refused before it runs, by a model spending limit, your Blazing Agents plan, the billing guard, or a model spending limit, ends with status `blocked` instead of `failed`. A spending limit that stops a Task run after model work started ends it `failed`. Make these calls on the signed-in user's End-user scoped client with an Agent that belongs to them. The scope sets the Turn's `userId`, which the billing guard checks.

```ts
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";

const tenant = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});

export async function ask(prompt: string, verifiedUserId: string): Promise<string> {
  try {
    const result = await tenant.forUser(verifiedUserId).completion({
      agentId: "ag_0123456789abcdef", // the user's Agent
      prompt,
    });
    return await result.text;
  } catch (error) {
    if (BlazingAgentsError.isInstance(error)) {
      switch (error.code) {
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

export async function runStatus(verifiedUserId: string, taskId: string, runId: string) {
  const run = await tenant.forUser(verifiedUserId).tasks.getRun({ taskId, runId });
  return run.status === "blocked" ? "Paused by a spending limit or billing" : run.status;
}
```

5. Connect your Polar or Dodo account, then turn on the billing switch. Start in `sandbox`. For Polar, use an Organization Access Token with only `organizations:read`, `customers:read`, and `events:write`, plus `products:read` and `meters:read` if you turn on the guard in step 7; for Dodo, an API key in the matching mode.

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

Send 1 to 100 distinct IDs per request. The response preserves their order and returns zero totals for visible Sessions with no usage in the requested period. A missing or inaccessible Session makes the whole request fail with 404. Both dates are optional together; without them the range is the last 30 days.

## Gotchas

- Going live replaces the `sandbox` connection with a `production` one. Replacing needs no `pending` events, discards `failed` ones, and drops every customer binding, because bindings belong to a connection. Link every user again; until then their Turns record `discarded` events that are never billed.
- In `usage.overview()`, `byAgent`, `byUser`, and the top models are capped at `limit` (1 to 20, default 5). Read totals from `totals` and the Agent count from `activeAgentCount`, not from a ranking. Render the model remainder bucket as "Other models" instead of dropping it, or `byModel` no longer adds up to `totals`.
- `userId: ""` in a bucket is real usage with no user label. `userId: null` means the query was not grouped by user. Show `""` as a row such as "No user".
- `from` and `to` are inclusive UTC dates. Pass both or neither (the default is the last 30 days), and keep the range to 31 days or fewer, or the call fails with `validation_failed`. Page longer periods month by month.
- Usage from `client.usage` is summed per day and includes finished Turns only. Show it to people, but charge customers from the events your provider receives, not from these numbers.
- The spending limit and guard checks run before a Turn starts, so concurrent or long Turns can overshoot a limit or balance. Alert well before the limit.
- A `blocked` Task run did not execute. Do not retry it in a loop; the next scheduled fire runs normally once the limit allows.
- `subscription_required` and `usage_credit_required` are about your own Blazing Agents plan. `merchant_*` codes are about your end user's plan in your provider. Show them different messages.
- A Turn with no `userId`, or a `userId` you never linked, records its event as `discarded` with `lastErrorCode` `MERCHANT_CUSTOMER_UNMAPPED`, and that usage is never billed. Link the user in step 6 before their first Turn, or turn on the guard so such a Turn fails with `merchant_customer_unmapped`.
- Turning `monetizationEnabled` off discards every event your provider has not accepted yet, and turning it back on does not backfill them.
- Keep usage queries and billing calls on your backend. A customer view must go through the signed-in user's End-user scoped client, never a `userId` filter sent by the browser.

## Check it works

- Run a chat on the scoped client for `app:test-user`, then call `usage.get()` on that client. `totals.requestCount` has grown by one.
- Call `usage.overview()` and add up every `byModel` bucket, including the remainder. The sums match `totals`.
- Call `usage.overview()` with a 7-day range. `daily` has exactly 7 buckets, including days with zero usage.
- Set a very low spending limit on a test account, then start a chat. Your app shows the `model_spending_limit_exceeded` message, and a submitted Task run ends as `blocked`.
- With a sandbox connection, link a test user and run one chat as them. `merchantUsageEvents.list()` shows an `accepted` event with the Turn's tokens, and the event appears on the customer in your provider.
- Run a chat as a user you never linked. Its event is `discarded` with `lastErrorCode` `MERCHANT_CUSTOMER_UNMAPPED`.

## Go deeper

- [Usage and spending limits](https://docs.blazingagents.com/platform/usage-and-spending-limits)
- [Bill your users for model tokens](https://docs.blazingagents.com/platform/monetization)
- [Usage: TypeScript](https://docs.blazingagents.com/sdk/typescript/usage), [Python](https://docs.blazingagents.com/sdk/python/usage), [REST](https://docs.blazingagents.com/api-reference/rest-api/usage)
- [Tenant settings: TypeScript](https://docs.blazingagents.com/sdk/typescript/tenant)
- [Monetization REST reference](https://docs.blazingagents.com/api-reference/rest-api/merchant)
- [Task runs](https://docs.blazingagents.com/automation/task-runs)
- [Errors](https://docs.blazingagents.com/api-reference/protocols/errors)
