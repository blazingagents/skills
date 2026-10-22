# Take your integration to production: Rust code

The Rust code for the steps of [Take your integration to production](production.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## One client per credential

```rust
use blazing_agents::Client;

let client = Client::builder()
    .on_response(|obs| {
        println!(
            "{} {} {} {} {:?}",
            obs.method,
            obs.path,
            obs.status,
            obs.duration.as_millis(),
            obs.request_id
        );
    })
    .build()?; // reads BLAZING_AGENTS_API_KEY
```

## Submit Task runs with an idempotency key

```rust
let day = "2026-10-16";
let created = client
    .tasks()
    .submit("tk_0123456789abcdef")
    .idempotency_key(format!("daily-report:{day}"))
    .await?;
println!("{}", created.run_id);
```
