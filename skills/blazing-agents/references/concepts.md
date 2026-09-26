# Blazing Agents concepts

Every Blazing Agents (BA) term you meet while building on BA, in plain words. Each entry says what the thing is, when you need it, and what it is easy to confuse it with. Use these names exactly when you read the SDKs and docs; they mean the same thing everywhere.

## Account and access

### Tenant

Your BA account: you (or your company) building a product on top of BA. Everything you create lives inside your tenant, and nothing is visible across tenants. Your own customers are not tenants.

Not the same as: an end user of your app. BA has no end-user accounts; you label work with your own user IDs instead. See [Attribution](#attribution-userid-and-metadata).

### API key

The bearer credential your backend uses to call BA. One key can reach everything in your tenant: every agent, session, and file. Create, name, and revoke keys in the dashboard; an API key cannot list, create, or revoke keys, including itself. Read it from `BLAZING_AGENTS_API_KEY` on your server and never ship it to a browser or mobile app.

Not the same as: a Provider key (your model account key) or a per-user token. BA has no key that is safe in client code, so your backend decides which user may reach which agent.

## Models and agents

### Provider

Your saved model account credential: a name, a provider type (such as `openrouter`), an optional base URL, and your model API key. BA stores the key and never returns it; responses show only its last four characters. You need at least one Provider before any agent can answer, because model calls run on your own model account (bring your own key).

Not the same as: a model. The Provider is the account; the agent picks the model identifier (such as `openai/gpt-6-luna`) that runs on it.

### Agent

The reusable setup behind every answer: Provider and model, instructions (system prompt), tool groups, MCP Connections, tool approval policies, Skills, and one attached Workspace. Create it once and call it by ID (`ag_...`) from chat, one-off generation, tasks, and chat bots. An agent with no Provider and model can be saved but cannot answer. You can disable an agent to refuse new turns without deleting it.

Not the same as: a Session. The agent is configuration; a session is one conversation with it.

### Version

A numbered, read-only snapshot of an agent's configuration. Version 1 is created with the agent, and every update saves the next one; there is no draft or publish step. You use versions to roll back a bad change or to pin a session, task, or call to a known-good configuration. Skills, Memories, the Workspace attachment, the Provider key, MCP credentials, `userId`, the avatar, and the enabled/disabled state are not part of a version, so they always use their current state.

Not the same as: a deployment or release. Without a pin, every new turn uses the latest version immediately.

### Admin Agent

A BA-managed agent that every tenant gets automatically. It powers BA's built-in assistant for managing your tenant, and the dashboard marks it **Powers BA Assist for this tenant**. You choose its Provider, model, and thinking level; BA controls everything else, so you cannot rename, disable, delete, or restore it, change its instructions or tools, or give it tasks (`admin_agent_managed`). It shows up in `agents.list()` next to your own agents, so keep your own record of the agent IDs your app created instead of treating every listed agent as yours.

Not the same as: an agent for your product. Build your own agents for your users.

## Conversations and turns

### Turn

One run of an agent, whatever started it: a chat message, a one-off completion or structured-output call, a task run, a chat bot message, or a continuation after a tool approval. Every turn is checked against your quota before it runs and metered after, even if it fails or is stopped. A chat turn saves the user and assistant messages together only when it finishes successfully, so read the whole stream.

Not the same as: a Session. A session holds many turns; one-off generation runs a turn with no session at all.

### Session

One stored conversation with one agent, identified by `ss_...`. BA returns the ID on the first chat call; pass it on the next call and the agent sees the whole history, so your backend never stores or replays messages. You need sessions for chat. When you delete a session you choose whether its Artifacts go too (`deleteArtifacts`, `delete_artifacts` in Python).

Not the same as: Memory. A session is one conversation; memories carry facts across conversations.

### Prompt

A saved message template with `{{variables}}`, used in place of a literal message on any generation call. Use one when your app sends the same kind of request repeatedly and you want to edit the wording without redeploying. Only the filled-in text enters the transcript.

Not the same as: the agent's instructions (system prompt). Instructions shape every turn; a Prompt is the input for one turn.

## What the agent knows and keeps

### Skill (runtime Skill)

A folder with a `SKILL.md` and optional supporting files that teaches one agent one workflow, such as drafting release notes. The agent sees only each skill's name and description until a task matches, then loads the full instructions. Use skills to add long, specialized instructions without paying for them in every prompt. A skill is attached to exactly one agent; copying it to another agent makes an independent copy.

Not the same as: this coding-agent skill. This document is a skill for your coding agent (Claude Code, Codex, Cursor) so it can build on BA. Runtime Skills are uploaded to BA and used by your BA agents while they serve your users. Also not the same as a tool: a skill teaches how, a tool acts.

### Memory

A short text note an agent keeps across sessions, such as "prefers concise status updates". A note can be general to the agent or scoped to one end user by `userId`. The agent saves and searches notes itself with the `memory` tool group, or you turn on `memoryInjectionEnabled` so relevant notes start every turn. Each agent has a capped pool; the least recently used notes are evicted when it is full.

Not the same as: session history, a knowledge base, or files. Memory is small facts, not documents.

### Workspace

A private, persistent file system and shell (`/workspace`) attached to an agent. Files survive between turns and sessions, and several agents can share one workspace. Creating an agent without `workspaceId` gives it a new one. It costs nothing until the agent first reads, writes, or runs something, and it needs the `workspace` tool group to be usable.

Not the same as: an Artifact. Workspace files are the agent's scratch space; your app cannot fetch them directly.

### Artifact

A finished file the agent deliberately publishes from its Workspace with `publish_artifacts` during a chat session or task run. Your app lists artifacts and gets a short-lived download URL to hand to a browser. Every publish creates a new artifact, and artifacts can outlive the agent and session that made them if you keep them on delete.

Not the same as: any file in the Workspace. Only published files are Artifacts, and stateless generation cannot publish.

## Tools

### Built-in tools

Ready-made abilities you switch on per agent in groups. `workspace` gives files and a shell (`read`, `write`, `edit`, `grep`, `glob`, `bash`, `publish_artifacts`), `write_todos` gives a planning list, and `memory` gives the memory tools. A new agent has none, so it can only talk until you turn groups on. The `tools` list you send replaces the whole selection.

Not the same as: MCP tools, which come from MCP Connections, not tool groups.

### MCP Connection

A saved link from your tenant to a remote MCP server (Streamable HTTP), including its credential. Save it once, then attach it to any agent through `mcpConnectionIds` to give that agent the server's tools. Use it to let agents call your own services or third-party APIs. BA stores the credential and the agent's shell never sees it.

Not the same as: a Chat Connection (a Slack or Telegram bot). Attaching a connection makes tools available; it does not grant permissions or skip tool approval.

### Tool approval

The rules for which tool calls run freely, are blocked, wait for a person, or are reviewed by the model first. Each agent has one policy for chat (`approvalInChat`) and one for tasks (`approvalInTasks`), each with a default mode (`full`, `deny`, `manual`, `auto`) and per-tool overrides. When a person must decide, the chat turn pauses; your backend sends the decision and streams the resumed answer. Only interactive chat can wait for a person; in tasks and one-off generation such calls are blocked.

Not the same as: access control for your users. Your backend still checks who may decide.

## Background work

### Task

A saved background job: an agent, a fixed prompt, and an optional schedule (`tk_...`). Use a task when work should run without a user waiting, such as a nightly report. A task holds no results itself; each execution is a Task run.

Not the same as: a Turn or a Session. A task is a definition you run many times.

### Task run

One background execution of a task (`tr_...`), started on demand or by its schedule. It moves through `queued`, `running`, then `succeeded`, `failed`, `canceled`, or `blocked`, and gets a fresh session holding its transcript. `blocked` means a quota, subscription, or credit check stopped it before running; it is not a failure. A task has at most one active run, and you pass an idempotency key so retries do not start duplicates.

Not the same as: a chat session. You poll or read a run later instead of streaming it to a user.

### Schedule

The clock on a task: `once` at a set time, `interval` every N milliseconds (at least one minute), or `cron` in a timezone. Each fire starts a task run. A fire that lands while a run is active is skipped, and missed times are not caught up later.

Not the same as: a separate cron job resource. A "cron job" in BA is just a task with a schedule.

## Channels

### Chat Connection

A link from one Slack app or Telegram bot to one agent. BA receives the messages, keeps a session per native conversation, posts replies, and shows tool approval buttons in the chat. Use it when your users should talk to the agent inside Slack or Telegram instead of your own UI. You supply your bot's credentials.

Not the same as: an MCP Connection, which gives an agent tools rather than a place to chat.

## Users, usage, and limits

### Attribution (`userId` and `metadata`)

A label you stamp on resources and turns to say which of your end users they are for: an opaque `userId` string you choose plus optional `metadata`. Set it when you create an agent, workspace, prompt, task, or memory, or on a turn (a session takes the label of its first turn); a `userId` never changes once set, and you can filter lists and usage by it. An empty `userId` means a tenant-level resource. Use it so you can list one user's sessions and bill or report per user without your own mapping tables.

Not the same as: permission. Your API key sees the whole tenant regardless of `userId`, so your backend must check that the signed-in user may reach a resource before calling BA.

### Usage

The token, request, and duration counts BA records for every turn, automatically. You query it by day and group it by agent, model, session, or `userId` to build dashboards or bill your own customers.

Not the same as: your BA bill or plan credit. Usage is what your turns consumed; model costs are billed by your own Provider account.

### Quota

An optional monthly ceiling on tokens, requests, or both that you set on your tenant, with a reset day. BA checks it before each turn; over the ceiling, chat and generation calls fail with `quota_exceeded` (HTTP 429) and task runs end as `blocked`. It is a safety valve against runaway loops: with no quota usage is unlimited, and a turn already running may overshoot.

Not the same as: your plan, usage credit, or rate limits. A quota is a limit you choose, not one BA sells you.

## How they fit together

```text
Tenant ── API key (your backend only)
  │
  ├─ Provider (your model key) ◄─────────────┐
  ├─ MCP Connection (remote tools) ◄─────────┤ referenced by
  ├─ Workspace (/workspace files) ◄──────────┤
  │                                          │
  ├─ Agent ─── Versions (config history) ────┘
  │    ├─ Skills, Memory, built-in tool groups, tool approval rules
  │    ├─ Session (chat) ── Turns ── Artifacts, tool approvals
  │    ├─ Task (+ Schedule) ── Task runs ── fresh Session ── Turn
  │    └─ Chat Connection (Slack/Telegram) ── Sessions ── Turns
  │
  ├─ Prompt (template used on any generation call)
  ├─ Admin Agent (BA Assist, managed by BA)
  └─ Usage (per Turn, by agent/model/session/userId) ── checked against Quota

Attribution (userId, metadata) labels Agents, Workspaces, Prompts, Sessions,
Tasks, Task runs, Memories, Artifacts, and Usage so you can filter per end user.
```

Every path ends in a Turn: that is the unit BA runs, meters, and checks against your quota.

## Go deeper

- [Getting started](getting-started.md) to make your first agent answer.
- [Why Blazing Agents](https://docs.blazingagents.com/why) for when BA fits and when it does not.
- [Agents](https://docs.blazingagents.com/agents/agents), [Sessions and turns](https://docs.blazingagents.com/platform/sessions-and-turns), and [Tenancy and attribution](https://docs.blazingagents.com/platform/tenancy-and-attribution) for full detail on the core pieces.
