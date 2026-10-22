# Let an Agent work with files and deliver them to your users: Rust code

The Rust code for the steps of [Let an Agent work with files and deliver them to your users](files-and-deliverables.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Create an Agent with the file tools the job needs, for the user who will chat with it

```rust
use blazing_agents::agents::AgentTool;
use blazing_agents::workspaces::WorkspaceTier;

let agent = client
    .agents()
    .create("Report writer")
    .user_id("app:user-42") // the user this Agent serves
    .model("prv_0123456789abcdef", "openai/gpt-6-luna")
    .instructions(
        "Write reports as Markdown files. \
         When a file is finished, publish it with publish_artifacts.",
    )
    .workspace_tier(WorkspaceTier::Plus)
    .tools([
        AgentTool::Read,
        AgentTool::Write,
        AgentTool::Bash,
        AgentTool::PublishArtifacts,
    ])
    .await?;
println!("{} {}", agent.id, agent.workspace_id);
```

## Step 2: To let several of a user's Agents work on the same files, create a Workspace with the same `userId` and attach each Agent to it

```rust
use blazing_agents::workspaces::{NetworkPolicy, WorkspaceTier};

let agent_ids = ["ag_0123456789abcdef", "ag_abcdef0123456789"];
let workspace = client
    .workspaces()
    .create()
    .name("Release files")
    .user_id("app:user-42") // the user who owns both Agents
    .tier(WorkspaceTier::Plus)
    .network_policy(NetworkPolicy::allowlist(["registry.npmjs.org"]))
    .await?;
for agent_id in agent_ids {
    client
        .agents()
        .update(agent_id)
        .workspace_id(&workspace.id)
        .await?;
}
println!("{}", workspace.id);
```

## Step 3: Ask for the file in a chat turn on the signed-in user's End-user scoped client, read the stream to the end, then list the Session's Artifacts through the same client

```rust
use blazing_agents::messages::UserMessage;
use futures_util::TryStreamExt;

let client = client.for_user("app:user-42")?; // the verified signed-in user
let mut stream = client
    .chat(
        "ag_0123456789abcdef",
        UserMessage::text("Write a short release summary to release.md, then publish it."),
    )
    .await?;
let session_id = stream.session_id().clone();
while stream.try_next().await?.is_some() {
    // or forward each chunk to your client
}
let page = client
    .artifacts()
    .list()
    .agent_id("ag_0123456789abcdef")
    .session_id(session_id)
    .await?;
let artifact_ids: Vec<_> = page.data.iter().map(|artifact| &artifact.artifact_id).collect();
```

## Step 4: Serve downloads from your backend through the signed-in user's scoped client, then redirect to a fresh download URL

```rust
let client = client.for_user("app:user-42")?; // the verified signed-in user
let url = client
    .artifacts()
    .create_download_url("at_0123456789abcdef")
    .await? // another user's Artifact fails with not_found: respond 404
    .url;
```

## Step 5: Clean up through the same scoped client

```rust
let client = client.for_user("app:user-42")?; // the verified signed-in user
client.artifacts().delete("at_0123456789abcdef").await?;
client
    .sessions()
    .delete("ag_0123456789abcdef", "ss_0123456789abcdef", true)
    .await?;
client.workspaces().delete("ws_0123456789abcdef").await?;
```
