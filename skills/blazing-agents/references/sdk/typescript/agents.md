# TypeScript Agents

The TypeScript client exposes `client.agents` to create and manage Agent configuration, lifecycle, Versions, avatars, and MCP attachments.

## Decision and workflow

1. Mutate through `client.agents`, then retrieve the Agent and inspect typed Version or lifecycle results.

Read [Agents](https://docs.blazingagents.com/agents/agents), the [quickstart](https://docs.blazingagents.com/getting-started/quickstart), and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/agents).

## Mistakes and verification

The [Agent concept](../../agents/agents.md) owns configuration and lifecycle boundaries. Verify request serialization, typed results, and `BlazingAgentsError` behavior for the methods used.

## Context compaction

Configure `autoCompaction` (default `true`) and `compactionReserveTokens`
(default `16384`, nonnegative safe integer) when creating or updating an Agent.
Both settings are versioned and restored. Verify defaults, disabled compaction,
and a custom reserve in the saved Agent and its Version. Summary calls count
toward Turn token usage; current context size is not cumulative billed usage.
Read the [compaction policy](https://docs.blazingagents.com/agents/agents#automatic-context-compaction)
for threshold behavior, unknown-model capacity, and overflow recovery.
