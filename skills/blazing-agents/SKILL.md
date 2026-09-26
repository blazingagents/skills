---
name: blazing-agents
description: Build products on Blazing Agents (BA), the hosted platform that runs production AI agents behind your backend. Use when the user wants to add an agent, chat, background or scheduled agent work, structured output, agent files, MCP tools, tool approvals, Slack/Telegram bots, usage dashboards, or token billing to their app with the BA TypeScript or Python SDK, or asks what BA is or can do. Use ba-admin instead for one-off Tenant administration. Do not use for generic AI-agent work without BA.
metadata:
  author: Blazing Agents
  version: "0.2.0"
---

# Blazing Agents

Blazing Agents (BA) runs production agents so the developer only writes the
agent's configuration and their own product. BA runs each Turn against the
developer's own model Provider and stores what an agent needs between Turns:
Session history, a Workspace with files and a shell, Skills, Memory, MCP
Connections, Tool approvals, background Tasks and schedules, usage records,
and token billing events.

The developer's backend is the only thing that calls BA. It signs in its users,
decides what each may access, and calls BA with the Tenant API key through the
TypeScript SDK (`@blazingagents/sdk`, 0.11.0 or later) or the Python SDK
(`blazing-agents`, 0.8.0 or later). Chat streams use the Vercel AI SDK UI message
format, so `useChat` renders them directly.

BA does not fit when the app must call it from the browser with no server, when
every Turn must run inside the developer's own infrastructure, or when the
developer wants to write the agent loop step by step.

## What you can build

| The product needs | Read |
| --- | --- |
| A first working agent, from API key to streamed answer | [Getting started](references/getting-started.md) |
| Chat inside a web or mobile app, with saved history | [Chat in your app](references/recipes/chat-in-your-app.md) |
| Many end users behind one Tenant key, an inbox of conversations | [Multi-user apps](references/recipes/multi-user-apps.md) |
| Agent work with no user present, on demand or on a schedule | [Background and scheduled work](references/recipes/background-and-scheduled.md) |
| JSON in a fixed shape, such as extraction or classification | [Structured output](references/recipes/structured-output.md) |
| An agent that reads and writes files, runs commands, and hands back files | [Files and deliverables](references/recipes/files-and-deliverables.md) |
| An agent that calls your services or third-party tools | [External tools with MCP](references/recipes/external-tools-mcp.md) |
| A person or a reviewing model approving risky tool calls | [Human approval](references/recipes/human-approval.md) |
| The same agent in Slack or Telegram | [Slack and Telegram](references/recipes/slack-and-telegram.md) |
| Better instructions, reusable prompts, Skills, Memory, rollback | [Shape agent behavior](references/recipes/shape-agent-behavior.md) |
| Usage dashboards, quotas, and billing end users for tokens | [Usage and billing](references/recipes/usage-dashboards.md) |

## Workflow

1. Map the request to rows in the table above and read those recipes. Read
   [Concepts](references/concepts.md) when a BA term is unclear.
2. Check the project's stack and the SDK version it has installed. Take method
   names and fields from [the TypeScript SDK](references/sdk-typescript.md) or
   [the Python SDK](references/sdk-python.md), and confirm anything not shown
   there against the installed package's types or the linked docs. Never guess
   a method, field, or limit.
3. Make sure the Tenant has a Provider and an Agent. Create them in code as in
   [Getting started](references/getting-started.md), in the BA dashboard, or with
   the `ba-admin` skill for a one-off setup.
4. Build the integration in the project's backend and frontend, following the
   recipe's steps.
5. Run the recipe's "Check it works" steps and the project's own checks. Before
   launch, walk through [Production](references/production.md). When something
   fails, start from [Troubleshooting](references/troubleshooting.md).

## Rules

- Keep the BA API key on the backend, read from `BLAZING_AGENTS_API_KEY`. Never
  ship it in browser or mobile code, logs, or Workspace files.
- The API key selects the Tenant. Never accept a Tenant from a request.
- `userId` and `metadata` label Sessions, Tasks, and usage for filtering and
  reporting. They grant no access. The backend decides which user may use which
  Agent and Session.
- Relay BA's stream as it is. Return `toResponse()` in TypeScript or forward the
  raw bytes in Python, and let `useChat` render it. Never parse the stream by hand.
- A chat Session ID arrives with the response. Save it and pass it back to
  continue the conversation. Load history from BA instead of storing your own copy.
- A resend or retry is a new attempt, and tool side effects can happen again.
  Use idempotency keys where BA offers them, such as Task runs.
- Provider and model are set together on an Agent. Every Agent change creates a
  Version, and a Task can pin one.
