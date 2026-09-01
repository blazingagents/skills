# ba run

Use `ba run` for one non-interactive prompt from a terminal, pipe, script, or CI job. Use `ba chat` for an interactive resumable TUI.

## Decision and workflow

1. Complete [setup and authentication](setup-and-authentication.md).
2. Choose supported input and output modes from current help.
3. Execute against the intended Agent, capture stdout/stderr and exit status, and retain correlation details needed for diagnosis.

```bash
ba run ag_0123456789abcdef --prompt 'Summarize the release status'
ba run ag_0123456789abcdef --prompt 'Return the status' --json
```

Read the exact [ba run reference](https://docs.blazingagents.com/cli/run), [Scripting and CI](https://docs.blazingagents.com/cli/scripting-and-ci), and [Generation and streaming](https://docs.blazingagents.com/agents/output/generation-and-streaming). Inspect exact [TypeScript generation](https://docs.blazingagents.com/sdk/typescript/client) and [REST generation](https://docs.blazingagents.com/api-reference/rest-api/generation) contracts when changing behavior.

## Mistakes and verification

Do not parse human-oriented output when a documented machine mode exists or expose credentials in command arguments. Verify stdin/file/direct input as applicable, output and exit status, cancellation, and error diagnostics. Interactive work belongs to [ba chat](chat.md).
