# Let an Agent work with files and deliver them to your users

You will have an Agent that reads, writes, and runs commands in its own Workspace, publishes finished files as Artifacts, and a backend that lists those files and hands your users a download link.

## When to use this

The Agent's job produces a file: a report, a CSV export, a generated document, or code it builds and tests. Or it needs a scratch disk that survives between conversations. If you instead want JSON your code consumes directly, read [Get typed JSON from an Agent](structured-output.md).

## How it works

Every Agent has a Workspace: a private file system with a shell, rooted at `/workspace`. Core files are lost when the Workspace stops after about 10 idle minutes; Plus keeps them across idle stops, which is why the examples below create Plus. The Agent touches the Workspace only through the file tools (`read`, `write`, `edit`, `grep`, `glob`, `bash`, `publish_artifacts`), which you switch on one by one in `tools`. Turn on only what the job needs: `read`, `grep`, and `glob` give read-only access. Workspace files are private. To hand one to your app, the Agent calls `publish_artifacts`, which makes a fixed copy called an Artifact, attached to the Session that published it. Your backend lists Artifacts by Agent or Session and creates short-lived download URLs.

## Build it

For a Python, Rust, or Go backend, read the code for these steps in [Python](files-and-deliverables.python.md), [Rust](files-and-deliverables.rust.md), [Go](files-and-deliverables.go.md).

1. Create an Agent with the file tools the job needs, for the user who will chat with it. This one writes reports, so it needs `write` and `publish_artifacts`, plus `read` and `bash` to check its work. Without file tools the Agent cannot touch files. Provisioning is a trusted Tenant operation, so it runs on the unscoped client with that user's `userId`; the Agent's own Workspace gets the same `userId`.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
if (!apiKey) throw new Error("Set BLAZING_AGENTS_API_KEY");
const client = new BlazingAgents({ apiKey });
declare const verifiedUserId: string; // the user this Agent serves

const agent = await client.agents.create({
  name: "Report writer",
  userId: verifiedUserId,
  providerId: "prv_0123456789abcdef",
  model: "openai/gpt-6-luna",
  instructions:
    "Write reports as Markdown files. When a file is finished, publish it with publish_artifacts.",
  workspaceTier: "plus",
  tools: ["read", "write", "bash", "publish_artifacts"],
});
console.log(agent.id, agent.workspaceId);
```

For an existing Agent, read `agent.tools` and send the full list with the new tools added. `tools` replaces the whole list and rejects duplicate names.

2. To let several of a user's Agents work on the same files, create a Workspace with the same `userId` and attach each Agent to it. A scoped chat on an Agent whose Workspace belongs to another user, or to no user, fails with `workspace_not_found`. Pick the narrowest network policy: `unrestricted` (default), `allowlist`, or `offline`.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const verifiedUserId: string; // the user who owns both Agents
declare const writerAgentId: string;
declare const reviewerAgentId: string;

const workspace = await client.workspaces.create({
  name: "Release files",
  userId: verifiedUserId,
  tier: "plus",
  networkPolicy: { mode: "allowlist", allowedHosts: ["registry.npmjs.org"] },
});

for (const agentId of [writerAgentId, reviewerAgentId]) {
  await client.agents.update({ agentId, workspaceId: workspace.id });
}
```

3. Ask for the file in a chat turn on the signed-in user's End-user scoped client, read the stream to the end, then list the Session's Artifacts through the same client. The scope sets the Session's `userId`, so the call needs none.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const tenant: BlazingAgents;

export async function writeReport(agentId: string, verifiedUserId: string) {
  const client = tenant.forUser(verifiedUserId);
  const turn = await client.chat({
    agentId,
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

A scoped chat needs an Agent and Workspace provisioned for that same user, as in steps 1 and 2; any other Agent returns `not_found`. The Artifacts the turn publishes belong to that user. See [multi-user apps](multi-user-apps.md).

4. Serve downloads from your backend through the signed-in user's scoped client, then redirect to a fresh download URL. BA returns `not_found` (404) for an Artifact from another user's Session, so you need no ownership check of your own.

```ts
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";

declare const tenant: BlazingAgents;

export async function downloadArtifact(
  artifactId: string,
  verifiedUserId: string
): Promise<Response> {
  try {
    const { url } = await tenant
      .forUser(verifiedUserId)
      .artifacts.createDownloadUrl({ artifactId });
    return Response.redirect(url, 302);
  } catch (error) {
    if (BlazingAgentsError.isInstance(error) && error.status === 404) {
      return new Response("Not found", { status: 404 });
    }
    throw error;
  }
}
```

5. Clean up through the same scoped client. Deleting an Artifact is permanent and leaves the Workspace file alone. When you delete a Session, choose whether its Artifacts go too. A Workspace can be deleted only after every Agent has moved off it.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const tenant: BlazingAgents;
declare const verifiedUserId: string;
declare const artifactId: string;
declare const workspaceId: string;

const client = tenant.forUser(verifiedUserId);
await client.artifacts.delete({ artifactId });
await client.sessions.delete({
  agentId: "ag_0123456789abcdef",
  sessionId: "ss_0123456789abcdef",
  deleteArtifacts: true,
});
await client.workspaces.delete({ workspaceId });
```

## Gotchas

- The Agent says it wrote a file but nothing happened. It lacks `write`. Add it to `tools`. The same goes for `publish_artifacts` when nothing was published.
- Listing Artifacts before the stream ends. The turn saves its results only when the stream is fully read. Drain or relay it first.
- Expecting a written file to show up as an Artifact. Only files passed to `publish_artifacts` are published. Tell the Agent to publish in its instructions or prompt.
- Asking for a file from `client.completion()` or `client.object()`. Stateless calls can use Workspace Tools but cannot publish. Use a chat Session or a Task run.
- Creating a download URL on the unscoped client. It reads every Artifact in your account. Use the signed-in user's scoped client, which returns 404 for another user's Artifact.
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
