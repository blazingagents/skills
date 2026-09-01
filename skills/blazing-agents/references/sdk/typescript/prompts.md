# TypeScript Prompts

The TypeScript client exposes `client.prompts` to manage reusable parameterized Prompts.

## Decision and workflow

1. Manage templates through `client.prompts`, then invoke them through the root generation methods.

Read [Prompts](https://docs.blazingagents.com/agents/prompts), the [structured-output guide](https://docs.blazingagents.com/agents/output/structured-output), and the exact [TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/prompts).

## Mistakes and verification

The [Prompt concept](../../agents/prompts.md) owns template and invocation boundaries. Verify typed variable input, request serialization, and valid/invalid variable handling for the methods used.
