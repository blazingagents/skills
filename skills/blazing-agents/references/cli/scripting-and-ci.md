# Scripting and CI

Use documented non-interactive CLI modes when shell integration is preferable to an SDK. Use an SDK when the application needs typed resource composition or native stream handling.

## Decision and workflow

1. Complete [setup and authentication](setup-and-authentication.md) with CI secrets.
2. Confirm current machine-readable input/output, exit codes, and command support.
3. Bound execution, preserve diagnostics, and make retries conditional on operation semantics.

```bash
export CI=1
ba run ag_0123456789abcdef \
  --prompt 'Summarize the release status' --json --tool-output off
```

Inject `BLAZING_AGENTS_API_KEY` from the CI secret manager before this step.

Read [Scripting and CI](https://docs.blazingagents.com/cli/scripting-and-ci), [ba run](https://docs.blazingagents.com/cli/run), and [Limits and reliability](https://docs.blazingagents.com/platform/limits-and-reliability). Inspect the exact SDK or REST reference for every command automated; `ba run` consumes the [TypeScript generation contract](https://docs.blazingagents.com/sdk/typescript/client).

## Mistakes and verification

Keep secrets masked, avoid brittle human-output parsing, and avoid blanket retries. Verify clean-environment authentication, stdin/stdout/stderr, exit codes, timeout/cancellation, and one failure path. Typed integration belongs to the selected [SDK client](../sdk/typescript/client.md).
