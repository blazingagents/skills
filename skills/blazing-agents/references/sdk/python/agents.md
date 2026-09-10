# Python Agents

The synchronous and asynchronous Python clients expose `agents` to create and manage Agent configuration, lifecycle, Versions, avatars, and MCP attachments.

## Decision and workflow

1. Choose the synchronous or asynchronous client, mutate through `agents`, then retrieve the Agent and inspect Version effects.

Read [Agents](https://docs.blazingagents.com/agents/agents), the [quickstart](https://docs.blazingagents.com/getting-started/quickstart), and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/agents).

## Mistakes and verification

The [Agent concept](../../agents/agents.md) owns configuration and lifecycle boundaries. Verify sync or async request construction, model conversion, and error handling for the operations used.

## Context compaction

Configure `auto_compaction` (default `True`) and `compaction_reserve_tokens`
(default `16384`, nonnegative safe integer) when creating or updating an Agent.
Both settings are versioned and restored. Verify defaults, disabled compaction,
and a custom reserve in the saved Agent and its Version. Summary calls count
toward Turn token usage; current context size is not cumulative billed usage.
Read the [compaction policy](https://docs.blazingagents.com/agents/agents#automatic-context-compaction)
for threshold behavior, unknown-model capacity, and overflow recovery.
