# Structured output

Structured output constrains model-generated data with JSON Schema. It is a stateless Turn and does not create a Session.

## Decision and workflow

1. Define the smallest schema accepted by the current client contract.
2. Call the root client's object-generation method and treat partial output as provisional.
3. Await and validate the final object before side effects.

Read [Structured output](https://docs.blazingagents.com/agents/output/structured-output) and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/client), [Python](https://docs.blazingagents.com/sdk/python/client), [REST](https://docs.blazingagents.com/api-reference/rest-api/generation), and [schema protocol](https://docs.blazingagents.com/api-reference/protocols/objects-and-schemas) references.

## Mistakes and verification

Do not create or resume a Session, treat partial objects as final, or call the result an Artifact. Verify schema rejection, final validation, and stateless behavior. Text/chat belongs to [Generation and streaming](generation-and-streaming.md); the CLI's machine-readable envelope is [`ba run --json`](../../cli/run.md), not schema-constrained model output.
