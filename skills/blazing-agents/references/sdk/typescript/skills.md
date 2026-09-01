# TypeScript Skills

The TypeScript client exposes `client.agent(agentId).skills` to create or upload, list, inspect, copy, delete, read files, and replace or delete files for Agent-owned runtime Skills.

## Decision and workflow

1. Select the owner with `const skills = client.agent(agentId).skills`, then create or upload and manage files or copies through that scoped resource.

Read [Skills](https://docs.blazingagents.com/agents/skills) and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/skills).

## Mistakes and verification

The [runtime Skill concept](../../agents/skills.md) owns package, activation, and artifact boundaries. Verify upload encoding, typed results, and errors for the methods used.
