# Python Prompts

The synchronous and asynchronous Python clients expose `prompts` to manage reusable parameterized Prompts.

## Decision and workflow

1. Choose the synchronous or asynchronous client, manage templates through `prompts`, then invoke them through root generation methods.

Read [Prompts](https://docs.blazingagents.com/agents/prompts), the [structured-output guide](https://docs.blazingagents.com/agents/output/structured-output), and the exact [Python SDK reference](https://docs.blazingagents.com/sdk/python/prompts).

## Mistakes and verification

The [Prompt concept](../../agents/prompts.md) owns template and invocation boundaries. Verify sync or async model conversion and valid/invalid variable handling for the operations used.
