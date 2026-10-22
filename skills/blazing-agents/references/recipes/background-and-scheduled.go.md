# Run agent work in the background or on a schedule: Go code

The Go code for the steps of [Run agent work in the background or on a schedule](background-and-scheduled.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 2: Create the Task

```go
scoped, err := client.ForUser("app:user-42") // the verified signed-in user
if err != nil {
	return err
}
created, err := scoped.Tasks.Create(ctx, ba.CreateTaskParams{
	AgentID:  agentID,
	Name:     "Morning summary",
	Prompt:   "Summarize yesterday's support tickets.",
	Metadata: ba.Metadata{"team": "support"},
	Schedule: ba.Value[ba.Schedule](ba.ScheduleCron{Expression: "0 9 * * 1-5", Timezone: new("Europe/London")}),
})
if err != nil {
	return err
}
fmt.Println(created.Task.ID)
```

## Step 3: Start a run on demand through the same user's scoped client

```go
week := "2026-W41"
scoped, err := client.ForUser("app:user-42") // the verified signed-in user
if err != nil {
	return err
}
created, err := scoped.Tasks.Submit(ctx, ba.TaskID("tk_0123456789abcdef"), ba.SubmitTaskParams{
	IdempotencyKey: new("weekly-report:" + week),
})
var apiErr *ba.APIError
switch {
case errors.As(err, &apiErr) && apiErr.Code == ba.ErrorCodeTaskActiveRunExists:
	fmt.Println("a run is already active")
case err != nil:
	return err
default:
	fmt.Println(created.RunID)
}
```

```go
reportDate := "2026-10-02"
scoped, err := client.ForUser("app:user-42")
if err != nil {
	return err
}
created, err := scoped.Tasks.Create(ctx, ba.CreateTaskParams{
	AgentID:        agentID,
	Name:           "Daily report",
	Prompt:         "Summarize activity for " + reportDate + ".",
	Submit:         new(true),
	IdempotencyKey: new("daily-report:" + reportDate),
})
if err != nil {
	return err
}
fmt.Println(created.Task.ID)
if created.RunID != nil {
	fmt.Println(*created.RunID)
}
```

## Step 4: Check the run later through the user's scoped client

```go
scoped, err := client.ForUser("app:user-42") // the verified signed-in user
if err != nil {
	return err
}
taskID, runID := ba.TaskID("tk_0123456789abcdef"), ba.TaskRunID("tr_0123456789abcdef")
for range 120 {
	run, err := scoped.Tasks.ListRunMessages(ctx, taskID, runID, ba.ListTaskRunMessagesParams{})
	if err != nil {
		return err
	}
	if run.Status != ba.TaskRunStatusQueued && run.Status != ba.TaskRunStatusRunning {
		fmt.Println(run.Status)
		if run.Error != nil {
			fmt.Println(*run.Error) // redact before logging
		}
		return nil
	}
	time.Sleep(5 * time.Second)
}
return fmt.Errorf("run %s did not finish in time", runID)
```

## Step 5: Find runs the schedule started

```go
scoped, err := client.ForUser("app:user-42") // the verified signed-in user
if err != nil {
	return err
}
taskID := ba.TaskID("tk_0123456789abcdef")
runs, err := scoped.Tasks.ListRuns(ctx, taskID, ba.ListTaskRunsParams{Limit: new(20)})
if err != nil {
	return err
}
for _, run := range runs.Data {
	fmt.Println(run.ID, run.Status, run.FinishedAt)
}

tasks, err := scoped.Tasks.List(ctx, ba.ListTasksParams{})
if err != nil {
	return err
}
for _, task := range tasks.Data {
	if task.LatestRun != nil {
		fmt.Println(task.Name, task.LatestRun.Status)
	}
}
```

## Step 6: Cancel a run, pause the schedule, or make the Task on-demand only, again through the user's scoped client

```go
scoped, err := client.ForUser("app:user-42") // the verified signed-in user
if err != nil {
	return err
}
taskID := ba.TaskID("tk_0123456789abcdef")
if err := scoped.Tasks.CancelRun(ctx, taskID, ba.TaskRunID("tr_0123456789abcdef")); err != nil {
	return err
}
if _, err := scoped.Tasks.Update(ctx, taskID, ba.UpdateTaskParams{Enabled: new(false)}); err != nil {
	return err
}
task, err := scoped.Tasks.Update(ctx, taskID, ba.UpdateTaskParams{Schedule: ba.Null[ba.Schedule]()})
if err != nil {
	return err
}
fmt.Println(task.NextFireAt)
```
