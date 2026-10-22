# Let an Agent work with files and deliver them to your users: Python code

The Python code for the steps of [Let an Agent work with files and deliver them to your users](files-and-deliverables.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Create an Agent with the file tools the job needs, for the user who will chat with it

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()  # reads BLAZING_AGENTS_API_KEY

agent = client.agents.create(
    name="Report writer",
    user_id="app:user-42",  # the user this Agent serves
    provider_id="prv_0123456789abcdef",
    model="openai/gpt-6-luna",
    instructions=(
        "Write reports as Markdown files. "
        "When a file is finished, publish it with publish_artifacts."
    ),
    workspace_tier="plus",
    tools=["read", "write", "bash", "publish_artifacts"],
)
print(agent.id, agent.workspace_id)
```

## Step 2: To let several of a user's Agents work on the same files, create a Workspace with the same `userId` and attach each Agent to it

```python
from blazing_agents import BlazingAgents


def share_workspace(client: BlazingAgents, user_id: str, agent_ids: list[str]) -> str:
    workspace = client.workspaces.create(
        name="Release files",
        user_id=user_id,
        tier="plus",
        network_policy={"mode": "allowlist", "allowed_hosts": ["registry.npmjs.org"]},
    )
    for agent_id in agent_ids:
        client.agents.update(agent_id, workspace_id=workspace.id)
    return workspace.id
```

## Step 3: Ask for the file in a chat turn on the signed-in user's End-user scoped client, read the stream to the end, then list the Session's Artifacts through the same client

```python
import uuid

from blazing_agents import BlazingAgents


def write_report(client: BlazingAgents, agent_id: str, verified_user_id: str) -> list[str]:
    scoped = client.for_user(verified_user_id)
    message: dict[str, object] = {
        "id": str(uuid.uuid4()),
        "role": "user",
        "parts": [
            {
                "type": "text",
                "text": "Write a short release summary to release.md, then publish it.",
            }
        ],
    }
    with scoped.chat(agent_id=agent_id, message=message) as stream:
        session_id = stream.session_id
        for _ in stream:
            pass  # or forward each chunk to your client
    page = scoped.artifacts.list(agent_id=agent_id, session_id=session_id)
    return [artifact.artifact_id for artifact in page.data]
```

## Step 4: Serve downloads from your backend through the signed-in user's scoped client, then redirect to a fresh download URL

```python
from blazing_agents import APIStatusError, BlazingAgents


def artifact_download_url(
    client: BlazingAgents, artifact_id: str, verified_user_id: str
) -> str | None:
    try:
        download = client.for_user(verified_user_id).artifacts.create_download_url(
            artifact_id=artifact_id
        )
    except APIStatusError as error:
        if error.status_code == 404:
            return None  # respond 404
        raise
    return str(download.url)
```

## Step 5: Clean up through the same scoped client

```python
from blazing_agents import BlazingAgents


def clean_up(
    client: BlazingAgents, verified_user_id: str, artifact_id: str, workspace_id: str
) -> None:
    scoped = client.for_user(verified_user_id)
    scoped.artifacts.delete(artifact_id=artifact_id)
    scoped.sessions.delete(
        agent_id="ag_0123456789abcdef",
        session_id="ss_0123456789abcdef",
        delete_artifacts=True,
    )
    scoped.workspaces.delete(workspace_id=workspace_id)
```
