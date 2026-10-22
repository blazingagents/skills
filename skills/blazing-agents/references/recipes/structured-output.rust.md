# Get typed JSON from an Agent: Rust code

The Rust code for the steps of [Get typed JSON from an Agent](structured-output.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Define the shape, send it as JSON Schema, and validate the final object

```rust
use blazing_agents::generation::ObjectSchema;
use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Deserialize, JsonSchema)]
struct Triage {
    /// billing, technical, or other
    category: String,
    urgent: bool,
    summary: String,
}

let triage: Triage = client
    .object(
        "ag_0123456789abcdef",
        "Triage this support message:\n\nWhere is my invoice?",
        ObjectSchema::derive(),
    )
    .await?;
println!("{} {}", triage.category, triage.summary);
```

## Step 2: To show progress, relay the stream from your backend

```rust
use blazing_agents::generation::ObjectSchema;
use futures_util::TryStreamExt;
use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Deserialize, JsonSchema)]
struct Triage {
    category: String,
    urgent: bool,
    summary: String,
}

let mut stream = client
    .object_stream::<Triage>(
        "ag_0123456789abcdef",
        "Triage this support message:\n\nWhere is my invoice?",
        ObjectSchema::derive(),
    )
    .await?;
while let Some(json_text) = stream.try_next().await? {
    print!("{json_text}"); // or forward it to your client
}
let triage: Triage = stream.final_object().await?;
println!("\n{} {}", triage.category, triage.summary);
```

## Step 3: To keep the wording out of your code, save a Prompt once and call it with `promptId` and `variables` instead of `prompt`

```rust
use blazing_agents::generation::{ObjectSchema, SavedPrompt};
use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Deserialize, JsonSchema)]
struct Triage {
    category: String,
    urgent: bool,
    summary: String,
}

let prompt = client
    .prompts()
    .create(
        "Support triage",
        "Triage this message from a {{ plan }} customer:\n\n{{ message }}",
    )
    .await?;
let triage: Triage = client
    .object(
        "ag_0123456789abcdef",
        SavedPrompt::new(&prompt.id)
            .var("plan", "pro")
            .var("message", "Where is my invoice?"),
        ObjectSchema::derive(),
    )
    .await?;
println!("{} {}", triage.category, triage.summary);
```
