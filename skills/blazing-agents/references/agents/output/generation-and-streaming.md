# Generation and streaming

Output is model-generated text or structured data. Choose stateful chat for history and durable decisions; choose stateless completion for one text result. Both execute a Turn and may stream.

## Decision and workflow

1. Choose chat or completion and direct text or a reusable Prompt.
2. Preserve the native stream through a backend when a frontend consumes it.
3. Record Session identity only for stateful chat and handle terminal stream errors.

Read [Generation and streaming](https://docs.blazingagents.com/agents/output/generation-and-streaming), [Sessions and Turns](https://docs.blazingagents.com/platform/sessions-and-turns), and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/client), [Python](https://docs.blazingagents.com/sdk/python/client), [REST](https://docs.blazingagents.com/api-reference/rest-api/generation), and [streaming protocol](https://docs.blazingagents.com/api-reference/protocols/streaming) references. For terminal execution, route to [`ba chat`](../../cli/chat.md), [`ba run`](../../cli/run.md), or the Admin Agent's [`ba assist`](../../cli/assist.md).

## Mistakes and verification

Preserve the native protocol and verify headers, relay, terminal result, and the selected stateful or stateless outcome. Credential placement belongs to [Security and credentials](../../platform/security-and-credentials.md); admission and transcript behavior belongs to [Sessions and Turns](../../platform/sessions-and-turns.md). Structured data belongs to [Structured output](structured-output.md); durable files are [Artifacts](../artifacts.md).
