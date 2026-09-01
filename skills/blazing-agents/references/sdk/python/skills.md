# Python Skills

The synchronous and asynchronous Python clients expose `client.agent(agent_id).skills` to create or upload, list, inspect, copy, delete, read files, and replace or delete files for Agent-owned runtime Skills.

## Decision and workflow

1. Choose the synchronous or asynchronous client, select the owner with `skills = client.agent(agent_id).skills`, then create or upload and manage files or copies through that scoped resource.

Read [Skills](https://docs.blazingagents.com/agents/skills) and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/skills).

## Mistakes and verification

The [runtime Skill concept](../../agents/skills.md) owns package, activation, and artifact boundaries. Verify sync or async upload encoding, model conversion, and errors for the operations used.
