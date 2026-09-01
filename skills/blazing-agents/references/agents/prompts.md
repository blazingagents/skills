# Prompts

A Prompt is a Tenant-owned reusable input template. Use one for shared, reviewed parameterized input; send direct input when text is local to one call.

## Decision and workflow

1. Define the template and variable contract.
2. Create or update it through a public client.
3. Invoke it from chat, completion, or object generation with exactly the required variables.

Read [Prompts](https://docs.blazingagents.com/agents/prompts), the [structured-output guide](https://docs.blazingagents.com/agents/output/structured-output), and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/prompts), [Python](https://docs.blazingagents.com/sdk/python/prompts), or [REST](https://docs.blazingagents.com/api-reference/rest-api/prompts) references.

## Mistakes and verification

Keep Prompt lifecycle separate from Agent Versions and never assume missing variables are filled. Verify creation plus one representative invocation. Output behavior belongs to [Generation and streaming](output/generation-and-streaming.md) or [Structured output](output/structured-output.md); terminal invocation is supported by [`ba run --prompt-id`](../cli/run.md).
