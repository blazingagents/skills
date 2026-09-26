# Let an Agent work with files and deliver them to your users

You will have an Agent that reads, writes, and runs commands in its own Workspace, publishes finished files as Artifacts, and a backend that lists those files and hands your users a download link.

## When to use this

The Agent's job produces a file: a report, a CSV export, a generated document, or code it builds and tests. Or it needs a scratch disk that survives between conversations. If you instead want JSON your code consumes directly, read [Get typed JSON from an Agent](structured-output.md).

## How it works

Every Agent has a Workspace: a private file system with a shell, rooted at `/workspace`. Files there outlive Sessions, so the next Session, Task run, or another Agent sharing the Workspace sees them. The Agent touches the Workspace only through Workspace Tools (`read`, `write`, `edit`, `grep`, `glob`, `bash`, `publish_artifacts`), which you switch on with the `workspace` tool group. Workspace files are private. To hand one to your app, the Agent calls `publish_artifacts`, which makes a fixed copy called an Artifact, attached to the Session that published it. Your backend lists Artifacts by Agent or Session and creates short-lived download URLs.

## Build it

1. Create an Agent with the `workspace` tool group. Without it the Agent cannot touch files.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
if (!apiKey) throw new Error("Set BLAZING_AGENTS_API_KEY");
const client = new BlazingAgents({ apiKey });

const agent = await client.agents.create({
  name: "Report writer",
  providerId: "prv_0123456789abcdef",
  model: "openai/gpt-6-luna",
  instructions:
    "Write reports as Markdown files. When a file is finished, publish it with publish_artifacts.",
  tools: ["workspace"],
});
console.log(agent.id, agent.workspaceId);
```

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()  # reads BLAZING_AGENTS_API_KEY

agent = client.agents.create(
    name="Report writer",
    provider_id="prv_0123456789abcdef",
    model="openai/gpt-6-luna",
    instructions=(
        "Write reports as Markdown files. "
        "When a file is finished, publish it with publish_artifacts."
    ),
    tools=["workspace"],
)
print(agent.id, agent.workspace_id)
```

For an existing Agent, read `agent.tools` and send the full list with `"workspace"` added. `tools` replaces the whole list.

2. To let several Agents work on the same files, create a Workspace and attach each Agent to it. Pick the narrowest network policy: `unrestricted` (default), `allowlist`, or `offline`.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const writerAgentId: string;
declare const reviewerAgentId: string;

const workspace = await client.workspaces.create({
  name: "Release files",
  networkPolicy: { mode: "allowlist", allowedHosts: ["registry.npmjs.org"] },
});

for (const agentId of [writerAgentId, reviewerAgentId]) {
  await client.agents.update({ agentId, workspaceId: workspace.id });
}
```

```python
from blazing_agents import BlazingAgents


def share_workspace(client: BlazingAgents, agent_ids: list[str]) -> str:
    workspace = client.workspaces.create(
        name="Release files",
        network_policy={"mode": "allowlist", "allowed_hosts": ["registry.npmjs.org"]},
    )
    for agent_id in agent_ids:
        client.agents.update(agent_id, workspace_id=workspace.id)
    return workspace.id
```

3. Ask for the file in a chat turn, read the stream to the end, then list the Session's Artifacts. Pass `userId` so each Artifact carries the Session's user ID, which you check before download.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;

export async function writeReport(agentId: string, userId: string) {
  const turn = await client.chat({
    agentId,
    userId,
    message: {
      id: crypto.randomUUID(),
      role: "user",
      parts: [
        {
          type: "text",
          text: "Write a short release summary to release.md, then publish it.",
        },
      ],
    },
  });
  const sessionId = await turn.sessionId;
  await turn.toResponse().text(); // In a chat UI, return turn.toResponse() instead.

  const { data } = await client.artifacts.list({ agentId, sessionId });
  return data.map((a) => ({ id: a.artifactId, filename: a.filename, size: a.sizeBytes }));
}
```

```python
import uuid

from blazing_agents import BlazingAgents


def write_report(client: BlazingAgents, agent_id: str, user_id: str) -> list[str]:
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
    with client.chat(agent_id=agent_id, user_id=user_id, message=message) as stream:
        session_id = stream.session_id
        for _ in stream:
            pass  # or forward each chunk to your client
    page = client.artifacts.list(agent_id=agent_id, session_id=session_id)
    return [artifact.artifact_id for artifact in page.data]
```

4. Serve downloads from your backend. Compare the Artifact's `userId` with the `userId` you send for the signed-in user on chat calls, then redirect to a fresh download URL.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;

export async function downloadArtifact(
  artifactId: string,
  signedInUserId: string
): Promise<Response> {
  const artifact = await client.artifacts.get({ artifactId });
  if (artifact.userId !== signedInUserId) {
    return new Response("Not found", { status: 404 });
  }
  const { url } = await client.artifacts.createDownloadUrl({ artifactId });
  return Response.redirect(url, 302);
}
```

```python
from blazing_agents import BlazingAgents


def artifact_download_url(
    client: BlazingAgents, artifact_id: str, signed_in_user_id: str
) -> str | None:
    artifact = client.artifacts.get(artifact_id=artifact_id)
    if artifact.user_id != signed_in_user_id:
        return None  # respond 404
    return str(client.artifacts.create_download_url(artifact_id=artifact_id).url)
```

5. Clean up. Deleting an Artifact is permanent and leaves the Workspace file alone. When you delete a Session, choose whether its Artifacts go too. A Workspace can be deleted only after every Agent has moved off it.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const artifactId: string;
declare const workspaceId: string;

await client.artifacts.delete({ artifactId });
await client.sessions.delete({
  agentId: "ag_0123456789abcdef",
  sessionId: "ss_0123456789abcdef",
  deleteArtifacts: true,
});
const status = await client.workspaces.delete({ workspaceId });
console.log(status); // "completed", or "pending" while cleanup finishes
```

```python
from blazing_agents import BlazingAgents


def clean_up(client: BlazingAgents, artifact_id: str, workspace_id: str) -> None:
    client.artifacts.delete(artifact_id=artifact_id)
    client.sessions.delete(
        agent_id="ag_0123456789abcdef",
        session_id="ss_0123456789abcdef",
        delete_artifacts=True,
    )
    print(client.workspaces.delete(workspace_id=workspace_id))
```

## Gotchas

- The Agent says it wrote a file but nothing happened. It lacks the `workspace` tool group. Add it to `tools`.
- Listing Artifacts before the stream ends. The turn saves its results only when the stream is fully read. Drain or relay it first.
- Expecting a written file to show up as an Artifact. Only files passed to `publish_artifacts` are published. Tell the Agent to publish in its instructions or prompt.
- Asking for a file from `client.completion()` or `client.object()`. Stateless calls can use Workspace Tools but cannot publish. Use a chat Session or a Task run.
- Creating a download URL without an ownership check. Your API key reads every Artifact in your account. Compare `userId` (or your own mapping) first.
- Storing or logging download URLs. They expire after five minutes and act like passwords. Create one per download.
- Trusting Artifact filenames, media types, or contents. The Agent produced them. Validate before you open or display them.
- Two Agents writing the same path in a shared Workspace. Nothing locks files. Give each Agent its own directory.
- Assuming a failed turn undoes file changes. Finished writes stay. Check the files when a failed turn matters.
- Editing a Workspace file and expecting the Artifact to change. An Artifact is a fixed copy. Publish again for a new version.

## Check it works

- Run `writeReport`. The result contains `release.md` with a nonzero size.
- Open the download link as the owning user. The file downloads. Try the same Artifact as another user. You get 404.
- Ask the Agent in one Session to write `note.txt`, then in a new Session to read it. The second Session sees the file.
- With two Agents on one shared Workspace, have one write a file and the other read it.
- Delete an Artifact, then call `artifacts.get` for it. The call fails with not found.

## Go deeper

- [Workspaces](https://docs.blazingagents.com/agents/workspaces)
- [Built-in tools](https://docs.blazingagents.com/agents/tools/built-in-tools)
- [Artifacts](https://docs.blazingagents.com/agents/artifacts)
- [TypeScript workspaces](https://docs.blazingagents.com/sdk/typescript/workspaces) and [artifacts](https://docs.blazingagents.com/sdk/typescript/artifacts)
- [Python workspaces](https://docs.blazingagents.com/sdk/python/workspaces) and [artifacts](https://docs.blazingagents.com/sdk/python/artifacts)
- [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals) to review risky calls such as `bash`
