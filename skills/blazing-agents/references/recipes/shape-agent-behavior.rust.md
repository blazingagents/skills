# Tune what your Agent does: Rust code

The Rust code for the steps of [Tune what your Agent does](shape-agent-behavior.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Set the model, instructions, and context compaction in one update

```rust
use blazing_agents::agents::AgentTool;

let provider_id = "prv_0123456789abcdef";
let models = client.providers().list_models(provider_id).await?.models;
if !models.iter().any(|model| model.id == "openai/gpt-6-luna") {
    return Err("Model not offered by this Provider".into());
}

let agent = client
    .agents()
    .update("ag_0123456789abcdef")
    .model(provider_id, "openai/gpt-6-luna")
    .instructions(
        "You are the support assistant for Acme. Answer in two short paragraphs.",
    )
    .tools([
        AgentTool::Read,
        AgentTool::Grep,
        AgentTool::Glob,
        AgentTool::SaveMemory,
        AgentTool::SearchMemories,
    ])
    .compaction_reserve_tokens(32_768)
    .await?;
println!("{:?} {}", agent.model, agent.instructions);
```

## Step 2: Save a Prompt linked to the Agent and run it with exactly its variables

```rust
use blazing_agents::generation::SavedPrompt;

let prompt = client
    .prompts()
    .create("Release summary", "Summarize {{ version }} for {{ audience }}.")
    .agent_id("ag_0123456789abcdef")
    .await?;
let answer = client
    .completion(
        "ag_0123456789abcdef",
        SavedPrompt::new(&prompt.id)
            .var("version", "2.4")
            .var("audience", "developers"),
    )
    .await?;
println!("{answer}");
let page = client
    .prompts()
    .list()
    .agent_id("ag_0123456789abcdef")
    .await?;
println!("{:?}", page.data.iter().map(|p| &p.name).collect::<Vec<_>>());
```

## Step 3: Upload a runtime Skill

```rust
use blazing_agents::files::Upload;
use blazing_agents::skills::ArchiveType;

let agent_handle = client.agent("ag_0123456789abcdef");
let skills = agent_handle.skills();
let skill = skills
    .upload(ArchiveType::Zip, Upload::file("release-notes.zip").await?)
    .await?;
println!("{} {:?}", skill.name, skill.files.iter().map(|f| &f.path).collect::<Vec<_>>());

skills
    .replace_file(
        &skill.id,
        "references/style-guide.md",
        Upload::bytes("Use sentence case headings.\n"),
    )
    .await?;
```

## Step 4: Store Memory for one End-user and turn on injection so every Turn of theirs starts with the newest notes it can see, general and that user's (up to 4,000 words)

```rust
client
    .agents()
    .update("ag_0123456789abcdef")
    .memory_injection_enabled(true)
    .await?;

let scoped = client.for_user("app:user-42")?; // the verified user who owns this Agent
let memory = scoped
    .memories()
    .create("ag_0123456789abcdef", "Prefers concise status updates.")
    .await?;

let page = scoped
    .memories()
    .list("ag_0123456789abcdef")
    .search("status")
    .await?;
println!("{:?}", page.data.iter().map(|m| &m.text).collect::<Vec<_>>());

scoped
    .memories()
    .update(
        "ag_0123456789abcdef",
        &memory.id,
        "Prefers bullet-point status updates.",
    )
    .await?;
scoped
    .memories()
    .delete("ag_0123456789abcdef", memory.id)
    .await?;
```

## Step 5: Read saved configuration and pause new work from trusted backend code with the unscoped client

```rust
let session = client
    .sessions()
    .get("ag_0123456789abcdef", "ss_0123456789abcdef")
    .await?;
println!("{:?} {}", session.agent_config.model, session.agent_config.instructions);

client
    .agents()
    .disable("ag_0123456789abcdef")
    .await?;
client.agents().enable("ag_0123456789abcdef").await?;
```
