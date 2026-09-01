# ba chat

Use `ba chat` for an interactive terminal conversation with an ordinary Agent and optional Session resume. Use `ba run` for pipes and automation.

## Decision and workflow

1. Complete [setup and authentication](setup-and-authentication.md).
2. Select the Agent using a currently supported identifier and start a new chat or provide a Session owned by that Agent.
3. Preserve the exit receipt needed to resume and handle cancellation as a request abort, not rollback of completed Tool effects.

```bash
ba chat 'Release Agent'
ba chat ag_0123456789abcdef --session ss_0123456789abcdef
```

Read the exact [ba chat reference](https://docs.blazingagents.com/cli/chat), plus [Sessions and Turns](https://docs.blazingagents.com/platform/sessions-and-turns) and [Generation and streaming](https://docs.blazingagents.com/agents/output/generation-and-streaming). Inspect exact [TypeScript generation](https://docs.blazingagents.com/sdk/typescript/client), [TypeScript Sessions](https://docs.blazingagents.com/sdk/typescript/sessions), and [REST Sessions](https://docs.blazingagents.com/api-reference/rest-api/sessions) contracts when changing behavior.

## Mistakes and verification

Do not script the TUI, use the Admin Agent here, or assume an unmaterialized first Session can resume. Verify new and resumed conversation, streamed output, receipt, cancellation, and failures. Scripted work belongs to [ba run](run.md).
