# Serve many end users from one account: Rust code

The Rust code for the steps of [Serve many end users from one account](multi-user-apps.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Derive a scoped client from the session your backend verified

```rust
let verified_user_id = "user_123";
let scoped = client.for_user(format!("app:{verified_user_id}"))?;
let page = scoped.agents().list().limit(50).await?;
```
