# Tune what your Agent does: Python code

The Python code for the steps of [Tune what your Agent does](shape-agent-behavior.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Set the model, instructions, and context compaction in one update

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
        tools=["read", "grep", "glob", "save_memory", "search_memories"],
        compaction_reserve_tokens=32_768,
    )
    print(agent.model, agent.instructions)
```

## Step 2: Save a Prompt linked to the Agent and run it with exactly its variables

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
    print([p.name for p in client.prompts.list(agent_id=agent_id).data])
```

## Step 3: Upload a runtime Skill

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

## Step 4: Store Memory for one End-user and turn on injection so every Turn of theirs starts with the newest notes it can see, general and that user's (up to 4,000 words)

```python
from blazing_agents import BlazingAgents


def curate_memory(client: BlazingAgents, agent_id: str, verified_user_id: str) -> None:
    client.agents.update(agent_id, memory_injection_enabled=True)

    scoped = client.for_user(verified_user_id)
    memory = scoped.memories.create(
        agent_id=agent_id, text="Prefers concise status updates."
    ).memory

    page = scoped.memories.list(agent_id=agent_id, search="status")
    print([m.text for m in page.data])

    scoped.memories.update(
        agent_id=agent_id, memory_id=memory.id, text="Prefers bullet-point status updates."
    )
    scoped.memories.delete(agent_id=agent_id, memory_id=memory.id)
```

## Step 5: Read saved configuration and pause new work from trusted backend code with the unscoped client

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()
agent_id = "ag_0123456789abcdef"
session_id = "ss_0123456789abcdef"

session = client.sessions.get(agent_id=agent_id, session_id=session_id)
print(session.agent_config.model, session.agent_config.instructions)

client.agents.disable(agent_id)
client.agents.enable(agent_id)
```
