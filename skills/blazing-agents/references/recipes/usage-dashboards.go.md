# Show usage and bill your users: Go code

The Go code for the steps of [Show usage and bill your users](usage-dashboards.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Load the dashboard with `usage.overview()`

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

## Step 2: Drill in with `usage.get()` or `usage.getForAgent()`, still on the unscoped client for internal views

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

## Step 3: Show one customer their own usage

```go
signedInUserID := "user_123"
scoped, err := client.ForUser("app:" + signedInUserID)
if err != nil {
	return err
}
usage, err := scoped.Usage.Get(ctx, ba.UsageParams{
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

## Step 4: Handle quota and plan outcomes

```go
scoped, err := client.ForUser("app:user-42") // the verified signed-in user
if err != nil {
	return err
}
answer, err := scoped.Generation.Completion(ctx, agentID, ba.Text("Summarize this ticket."), ba.GenerateParams{})
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

run, err := scoped.Tasks.GetRun(ctx, ba.TaskID("tk_0123456789abcdef"), ba.TaskRunID("tr_0123456789abcdef"))
if err != nil {
	return err
}
status := string(run.Status)
if run.Status == ba.TaskRunStatusBlocked {
	status = "Paused by quota or billing"
}
fmt.Println(status)
```

## Step 5: Connect your Polar or Dodo account, then turn on the billing switch

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

## Step 6: When a user signs up or starts a paid plan, create the customer in your provider, then link your `userId` to it

```go
binding, err := client.MerchantBindings.Set(ctx, "app:user_123", ba.SetMerchantBindingParams{CustomerID: "cus_0123456789"})
if err != nil {
	return err
}
fmt.Println(binding.UserID, binding.CustomerID)
```

## Step 7: Optionally require a paid plan or positive balance before each Turn, and watch delivery

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

## Exact usage for a Session list

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
