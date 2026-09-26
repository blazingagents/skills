# Tune what your Agent does

By the end, your Agent runs the model you chose with your instructions, reuses saved Prompts, loads runtime Skills when a task needs them, remembers facts per user, and you can pin or roll back any configuration change.

## When to use this

Your Agent answers, but you want to change how it behaves: tone and rules, model, reusable request templates, longer workflows, facts about each End-user, or long-conversation handling. You also want a safe way to undo a bad change.
If you instead want the Agent to take actions against outside systems, read [Connect external tools with MCP](external-tools-mcp.md).

## How it works

An Agent holds versioned configuration: Provider and model, thinking level, instructions, Tool groups, approval policies, Memory injection, and compaction settings. Every `update()` saves a new immutable Version, and each Turn uses the latest Version unless you pin one. Three things live beside the Agent and always use their current state: Prompts (saved input templates with `{{variables}}`), runtime Skills (instruction packages the Agent loads on demand), and Memory (short notes scoped to the Agent and optionally to one `userId`). Instructions shape every Turn; a Prompt is the input for one Turn.

## Build it

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
  tools: ["workspace", "memory"],
  compactionReserveTokens: 32_768,
});
console.log(`Now at version ${agent.version}`);
```

```python
from blazing_agents import BlazingAgents


def configure(client: BlazingAgents, agent_id: str, provider_id: str) -> None:
    models = client.providers.list_models(provider_id).models
    if not any(m.id == "openai/gpt-6-luna" for m in models):
        raise RuntimeError("Model not offered by this Provider")

    agent = client.agents.update(
        agent_id,
        provider_id=provider_id,
        model="openai/gpt-6-luna",
        instructions="You are the support assistant for Acme. Answer in two short paragraphs.",
        tools=["workspace", "memory"],
        compaction_reserve_tokens=32_768,
    )
    print(f"Now at version {agent.version}")
```

2. Save a Prompt linked to the Agent and run it with exactly its variables. `agentId` groups Prompts for listing; any Agent can still use the Prompt.

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

const { prompts } = await client.prompts.list({ agentId });
console.log(prompts.map(({ name }) => name));
```

```python
from blazing_agents import BlazingAgents


def run_prompt(client: BlazingAgents, agent_id: str) -> None:
    prompt = client.prompts.create(
        name="Release summary",
        template="Summarize {{ version }} for {{ audience }}.",
        agent_id=agent_id,
    )
    print(
        client.completion(
            agent_id=agent_id,
            prompt_id=prompt.id,
            variables={"version": "2.4", "audience": "developers"},
        )
    )
    print([p.name for p in client.prompts.list(agent_id=agent_id).prompts])
```

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

```python
from blazing_agents import BlazingAgents


def add_skill(client: BlazingAgents, agent_id: str) -> None:
    skills = client.agent(agent_id).skills
    skill = skills.upload(archive_type="zip", file="release-notes.zip")
    print(skill.name, [f.path for f in skill.files])

    skills.replace_file(
        skill_id=skill.id,
        path="references/style-guide.md",
        content=b"Use sentence case headings.\n",
    )
```

4. Store Memory for one End-user and turn on injection so every Turn with that `userId` starts with the newest notes it can see, general and that user's (up to 4,000 words). Use list with `search`, `update()`, and `delete()` to curate them.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
const agentId = "ag_0123456789abcdef";
const userId = "app-user-42";

await client.agents.update({ agentId, memoryInjectionEnabled: true });
const { memory } = await client.memories.create({
  agentId,
  userId,
  text: "Prefers concise status updates.",
});

const { data } = await client.memories.list({ agentId, userId, search: "status" });
console.log(data.map(({ text }) => text));

await client.memories.update({ agentId, memoryId: memory.id, text: "Prefers bullet-point status updates." });
await client.memories.delete({ agentId, memoryId: memory.id });
```

```python
from blazing_agents import BlazingAgents


def curate_memory(client: BlazingAgents, agent_id: str, user_id: str) -> None:
    client.agents.update(agent_id, memory_injection_enabled=True)
    memory = client.memories.create(
        agent_id=agent_id, user_id=user_id, text="Prefers concise status updates."
    ).memory

    page = client.memories.list(agent_id=agent_id, user_id=user_id, search="status")
    print([m.text for m in page.data])

    client.memories.update(
        agent_id=agent_id, memory_id=memory.id, text="Prefers bullet-point status updates."
    )
    client.memories.delete(agent_id=agent_id, memory_id=memory.id)
```

5. Pin, roll back, and pause with Versions. Pass `version` to run a known-good configuration. `restoreVersion()` copies an old Version into a new latest one. `disable()` stops new Turns without deleting anything.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
const agentId = "ag_0123456789abcdef";

const { data } = await client.agents.listVersions({ agentId, limit: 2 });
const previous = data[1];
if (!previous) throw new Error("Only one Version exists");

const pinned = await client.completion({ agentId, version: previous.version, prompt: "Reply with OK." });
console.log(await pinned.text);

const restored = await client.agents.restoreVersion({ agentId, version: previous.version });
console.log(`Restored ${previous.version} as ${restored.version}`);

await client.agents.disable({ agentId });
await client.agents.enable({ agentId });
```

```python
from blazing_agents import BlazingAgents


def roll_back(client: BlazingAgents, agent_id: str) -> None:
    versions = client.agents.list_versions(agent_id, limit=2).data
    if len(versions) < 2:
        raise RuntimeError("Only one Version exists")
    previous = versions[1]

    print(client.completion(agent_id=agent_id, version=previous.version, prompt="Reply with OK."))

    restored = client.agents.restore_version(agent_id, previous.version)
    print(f"Restored {previous.version} as {restored.version}")

    client.agents.disable(agent_id)
    client.agents.enable(agent_id)
```

## Gotchas

- `tools` and `mcpConnectionIds` replace the whole list on `update()`. Send the full list you want.
- Changing only `model` keeps the Provider; switching Provider needs `providerId` and `model` together, or the update fails validation.
- A Prompt call must supply every variable and no extras (`prompt_variable_missing`, `prompt_variable_unknown`). A call uses `promptId` or a literal `prompt`, never both.
- Deleting an Agent deletes its linked Prompts. Set the Prompt's `agentId` to `null` first to keep it.
- Uploading a Skill whose `name` already exists on the Agent fails with `skill_name_conflict`. Edit it with `putFile()` / `replace_file()`, or delete it and upload again.
- Skills and Memory are not part of Versions. Restoring a Version does not bring back old Skill content or notes.
- Memory `userId` sorts notes; it is not access control. Your backend decides which End-user maps to which `userId`. A Turn without `userId` sees only general notes (`userId: ""`).
- Memory search matches words, not meaning. Each Agent keeps up to 500 notes and evicts the least recently used one when full.
- A Session started with `version` stays on it for every Turn. Start a new Session to pick up a restored Version.
- A disabled Agent rejects new Turns with `agent_disabled`, and scheduled Task runs are skipped, not queued.

## Check it works

- `client.agents.get()` shows the new `model`, `instructions`, and a higher `version`; `getVersion()` for the previous number still shows the old values.
- Run the Prompt twice with different `variables`; each answer reflects its inputs.
- Ask a question that matches your Skill's description; the answer follows the Skill's instructions.
- After saving a note for `app-user-42`, a fresh Session with `userId: "app-user-42"` answers using it, and one without `userId` does not.
- Restore the previous Version, then compare a completion with and without `version`; both use the restored configuration.

## Go deeper

- [Agents](https://docs.blazingagents.com/agents/agents), including [automatic context compaction](https://docs.blazingagents.com/agents/agents#automatic-context-compaction)
- [Providers and models](https://docs.blazingagents.com/agents/providers-and-models)
- [Prompts](https://docs.blazingagents.com/agents/prompts), [Skills](https://docs.blazingagents.com/agents/skills), [Memory](https://docs.blazingagents.com/agents/memory)
- [Versions and lifecycle](https://docs.blazingagents.com/agents/versions-and-lifecycle)
- SDK references: TypeScript [Agents](https://docs.blazingagents.com/sdk/typescript/agents), [Prompts](https://docs.blazingagents.com/sdk/typescript/prompts), [Skills](https://docs.blazingagents.com/sdk/typescript/skills), [Memories](https://docs.blazingagents.com/sdk/typescript/memories); Python [Agents](https://docs.blazingagents.com/sdk/python/agents), [Prompts](https://docs.blazingagents.com/sdk/python/prompts), [Skills](https://docs.blazingagents.com/sdk/python/skills), [Memories](https://docs.blazingagents.com/sdk/python/memories)
