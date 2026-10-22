# Take your integration to production: Go code

The Go code for the steps of [Take your integration to production](production.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## One client per credential

```go
observed, err := ba.NewClient(ba.WithObserver(func(o ba.ResponseObservation) {
	log.Println(o.Method, o.Path, o.Status, o.Duration.Milliseconds(), o.RequestID)
})) // reads BLAZING_AGENTS_API_KEY
if err != nil {
	return err
}
if _, err := observed.Agents.List(ctx, ba.ListAgentsParams{}); err != nil {
	return err
}
```

## Submit Task runs with an idempotency key

```go
day := "2026-10-16"
created, err := client.Tasks.Submit(ctx, ba.TaskID("tk_0123456789abcdef"), ba.SubmitTaskParams{
	IdempotencyKey: new("daily-report:" + day),
})
if err != nil {
	return err
}
fmt.Println(created.RunID)
```
