# Tune what your Agent does

By the end, your Agent runs the model you chose with your instructions, reuses saved Prompts, loads runtime Skills when a task needs them, remembers facts per user, and existing Sessions keep the configuration saved at their first Turn.

## When to use this

Your Agent answers, but you want to change how it behaves: tone and rules, model, reusable request templates, longer workflows, facts about each End-user, or long-conversation handling. You also want to inspect what configuration an earlier Session used.
If you instead want the Agent to take actions against outside systems, read [Connect external tools with MCP](external-tools-mcp.md).

## How it works

An Agent holds configuration: Provider and model, thinking level, instructions, built-in tools, approval policies, Memory injection, and compaction settings. Edits reach new Sessions, Task runs queued afterwards, and stateless calls; an existing Session keeps the configuration from its first Turn. Three things live beside the Agent and always use their current state: Prompts (saved input templates with `{{variables}}`), runtime Skills (instruction packages the Agent loads on demand), and Memory (short notes scoped to the Agent and optionally to one `userId`). Instructions shape every Turn; a Prompt is the input for one Turn.

## Build it

For a Python, Rust, or Go backend, read the code for these steps in [Python](shape-agent-behavior.python.md), [Rust](shape-agent-behavior.rust.md), [Go](shape-agent-behavior.go.md).

1. Set the model, instructions, and context compaction in one update. Confirm the model is offered by the Provider, and send `providerId` and `model` together. `autoCompaction` (default `true`) summarizes older messages near the model's context limit; `compactionReserveTokens` (default `16384`) is how much room to keep free, so a larger value compacts sooner.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
const agentId = "ag_0123456789abcdef";
const providerId = "prv_0123456789abcdef";

const { models } = await client.providers.listModels({ providerId });
if (!models.some(({ id }) => id === "openai/gpt-6-luna")) {
  throw new Error("Model not offered by this Provider");
}

const agent = await client.agents.update({
  agentId,
  providerId,
  model: "openai/gpt-6-luna",
  instructions: "You are the support assistant for Acme. Answer in two short paragraphs.",
  tools: ["read", "grep", "glob", "save_memory", "search_memories"],
  compactionReserveTokens: 32_768,
});
console.log(agent.model, agent.instructions);
```

The file tools here are the `file_read`-tagged ones (`read`, `grep`, `glob`), so the Agent can search its Workspace but never change it. Add `write` or `edit` to let it change files; add `bash` only if it may run any command. See [Built-in tools](../concepts.md#built-in-tools).

2. Save a Prompt linked to the Agent and run it with exactly its variables. `agentId` groups Prompts for listing. These samples are trusted Tenant setup on the unscoped client. When a signed-in user saves or runs their own Prompts, use their End-user scoped client; the Prompt and Agent must then belong to that user.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
const agentId = "ag_0123456789abcdef";

const prompt = await client.prompts.create({
  name: "Release summary",
  template: "Summarize {{ version }} for {{ audience }}.",
  agentId,
});

const result = await client.completion({
  agentId,
  promptId: prompt.id,
  variables: { version: "2.4", audience: "developers" },
});
console.log(await result.text);

const { data: prompts } = await client.prompts.list({ agentId });
console.log(prompts.map(({ name }) => name));
```

These list calls show the first page. Follow `nextCursor` or `next_cursor` for the remaining Prompts.

3. Upload a runtime Skill: a ZIP (or tar, tar.gz) with `SKILL.md` at the archive root plus any reference files. Edit one file later with `putFile()`.

```text
release-notes/            zip the contents, not the folder
├── SKILL.md              frontmatter: name (lowercase-hyphen), description
└── references/style-guide.md
```

```ts
import { readFile } from "node:fs/promises";
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
const skills = client.agent({ agentId: "ag_0123456789abcdef" }).skills;

const skill = await skills.upload({
  source: { file: await readFile("release-notes.zip"), type: "zip" },
});
console.log(skill.name, skill.files.map(({ path }) => path));

await skills.putFile({
  skillId: skill.id,
  path: "references/style-guide.md",
  content: "Use sentence case headings.\n",
});
```

4. Store Memory for one End-user and turn on injection so every Turn of theirs starts with the newest notes it can see, up to 4,000 words. A scoped Turn sees only that user's notes; an unscoped Turn whose Session has a `userId` sees the Agent's general notes plus that user's. Turning on injection is Agent configuration on the unscoped client. The Memory calls run on that user's End-user scoped client, which sets `userId` and sees only their notes, so the Agent must belong to that user. Use list with `search`, `update()`, and `delete()` to curate them.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const tenant: BlazingAgents;
declare const verifiedUserId: string; // the user who owns this Agent
const agentId = "ag_0123456789abcdef";

await tenant.agents.update({ agentId, memoryInjectionEnabled: true });

const client = tenant.forUser(verifiedUserId);
const { memory } = await client.memories.create({
  agentId,
  text: "Prefers concise status updates.",
});

const { data } = await client.memories.list({ agentId, search: "status" });
console.log(data.map(({ text }) => text));

await client.memories.update({ agentId, memoryId: memory.id, text: "Prefers bullet-point status updates." });
await client.memories.delete({ agentId, memoryId: memory.id });
```

5. Read saved configuration and pause new work from trusted backend code with the unscoped client. Edit the Agent for future Sessions and Task runs. The existing Session keeps its saved settings.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const agentId: string;
declare const sessionId: string;

const session = await client.sessions.get({ agentId, sessionId });
console.log(session.agentConfig.model, session.agentConfig.instructions);

await client.agents.disable({ agentId });
await client.agents.enable({ agentId });
```

## Gotchas

- `tools` and `mcpConnectionIds` replace the whole list on `update()`. Send the full list you want.
- Changing only `model` keeps the Provider; switching Provider needs `providerId` and `model` together, or the update fails validation.
- A Prompt call must supply every variable and no extras (`prompt_variable_missing`, `prompt_variable_unknown`). A call uses `promptId` or a literal `prompt`, never both.
- Deleting an Agent deletes its linked Prompts. Set the Prompt's `agentId` to `null` first to keep it.
- Uploading a Skill whose `name` already exists on the Agent fails with `skill_name_conflict`. Edit it with `putFile()` / `replace_file()` / `Skills.ReplaceFile()`, or delete it and upload again.
- Skills and Memory use their current content; the saved Agent configuration holds neither file contents nor notes.
- Memory `userId` labels notes. Use the verified user scope from [multi-user apps](multi-user-apps.md) for user-owned Memory and Turns. A scoped Turn sees only that user's notes, never the general ones. An unscoped Turn sees the general notes plus those of its Session's `userId`.
- Memory search matches words, not meaning. Each Agent keeps up to 500 notes in one pool shared by all its End-users, and evicts the least recently used one silently when full, so busy users can push out other users' notes. Each note is at most 10 KiB, and notes are deleted with the Agent.
- A disabled Agent rejects new Turns with `agent_disabled`, and scheduled Task runs are skipped, not queued.

## Check it works

- `client.agents.get()` shows the new `model` and `instructions`; `sessions.get()` shows the settings saved for an existing Session.
- Run the Prompt twice with different `variables`; each answer reflects its inputs.
- Ask a question that matches your Skill's description; the answer follows the Skill's instructions.
- After saving a note through `app-user-42`'s scoped client, a fresh Session on that client answers using it. Another user's scoped client cannot list or read the note.

## Go deeper

- [Agents](https://docs.blazingagents.com/agents/agents), including [automatic context compaction](https://docs.blazingagents.com/agents/agents#automatic-context-compaction)
- [Providers and models](https://docs.blazingagents.com/agents/providers-and-models)
- [Prompts](https://docs.blazingagents.com/agents/prompts), [Skills](https://docs.blazingagents.com/agents/skills), [Memory](https://docs.blazingagents.com/agents/memory)
- [Configuration snapshots and lifecycle](https://docs.blazingagents.com/agents/configuration-snapshots)
- SDK references: TypeScript [Agents](https://docs.blazingagents.com/sdk/typescript/agents), [Prompts](https://docs.blazingagents.com/sdk/typescript/prompts), [Skills](https://docs.blazingagents.com/sdk/typescript/skills), [Memories](https://docs.blazingagents.com/sdk/typescript/memories); Python [Agents](https://docs.blazingagents.com/sdk/python/agents), [Prompts](https://docs.blazingagents.com/sdk/python/prompts), [Skills](https://docs.blazingagents.com/sdk/python/skills), [Memories](https://docs.blazingagents.com/sdk/python/memories)
