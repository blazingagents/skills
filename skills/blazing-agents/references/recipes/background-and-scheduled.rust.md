# Run agent work in the background or on a schedule: Rust code

The Rust code for the steps of [Run agent work in the background or on a schedule](background-and-scheduled.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 2: Create the Task

```rust
use blazing_agents::tasks::Schedule;
use blazing_agents::types::Metadata;

let client = client.for_user("app:user-42")?; // the verified signed-in user
let created = client
    .tasks()
    .create(
        "ag_0123456789abcdef",
        "Morning summary",
        "Summarize yesterday's support tickets.",
    )
    .metadata(Metadata::new().insert("team", "support"))
    .schedule(Schedule::cron("0 9 * * 1-5").timezone("Europe/London"))
    .await?;
println!("{}", created.task.id);
```

## Step 3: Start a run on demand through the same user's scoped client

```rust
use blazing_agents::error::ErrorCode;
use blazing_agents::Error;

let week = "2026-W41";
let client = client.for_user("app:user-42")?; // the verified signed-in user
let run_id = match client
    .tasks()
    .submit("tk_0123456789abcdef")
    .idempotency_key(format!("weekly-report:{week}"))
    .await
{
    Ok(created) => Some(created.run_id),
    Err(Error::Api(error)) if error.code() == &ErrorCode::TaskActiveRunExists => None,
    Err(error) => return Err(error.into()),
};
println!("{run_id:?}");
```

```rust
let report_date = "2026-10-02";
let created = client
    .for_user("app:user-42")?
    .tasks()
    .create(
        "ag_0123456789abcdef",
        "Daily report",
        &format!("Summarize activity for {report_date}."),
    )
    .submit(true)
    .idempotency_key(format!("daily-report:{report_date}"))
    .await?;
println!("{} {:?}", created.task.id, created.run_id);
```

## Step 4: Check the run later through the user's scoped client

```rust
use blazing_agents::tasks::TaskRunStatus;

let client = client.for_user("app:user-42")?; // the verified signed-in user
for _ in 0..120 {
    let run = client
        .tasks()
        .run_messages("tk_0123456789abcdef", "tr_0123456789abcdef")
        .await?;
    if !matches!(run.status, TaskRunStatus::Queued | TaskRunStatus::Running) {
        println!("{} {:?}", run.status.as_str(), run.error);
        return Ok(());
    }
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
}
return Err("Run tr_0123456789abcdef did not finish in time".into());
```

## Step 5: Find runs the schedule started

```rust
let client = client.for_user("app:user-42")?; // the verified signed-in user
let runs = client
    .tasks()
    .list_runs("tk_0123456789abcdef")
    .limit(20)
    .await?;
for run in &runs.data {
    println!("{} {} {:?}", run.id, run.status.as_str(), run.finished_at);
}

let tasks = client.tasks().list().await?;
for task in &tasks.data {
    println!(
        "{} {:?}",
        task.name,
        task.latest_run.as_ref().map(|run| run.status.as_str())
    );
}
```

## Step 6: Cancel a run, pause the schedule, or make the Task on-demand only, again through the user's scoped client

```rust
let client = client.for_user("app:user-42")?; // the verified signed-in user
client
    .tasks()
    .cancel_run("tk_0123456789abcdef", "tr_0123456789abcdef")
    .await?;
client
    .tasks()
    .update("tk_0123456789abcdef")
    .enabled(false)
    .await?;
client
    .tasks()
    .update("tk_0123456789abcdef")
    .clear_schedule()
    .await?;
```
