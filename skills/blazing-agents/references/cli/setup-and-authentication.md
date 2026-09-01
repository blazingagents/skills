# CLI setup and authentication

Use the CLI for supported terminal workflows. Installation details and flags are volatile, so follow shipped CLI documentation rather than guessing a package or coding-agent installation method.

## Decision and workflow

1. Use Node.js 24 or newer, install the CLI, and inspect its version and help.
2. Authenticate and verify a trusted workstation with `ba --login` and `ba --status`.
3. Remove the local credential with `ba --logout`; revoke the remote API key separately when required.

```bash
npm install --global @blazing-agents/cli
ba --version
ba --help
ba --login
ba --status
ba --logout
```

Read [CLI setup and authentication](https://docs.blazingagents.com/cli/setup-and-authentication), the [CLI overview](https://docs.blazingagents.com/cli), [Security and credentials](https://docs.blazingagents.com/platform/security-and-credentials), and [Tenancy and Attribution](https://docs.blazingagents.com/platform/tenancy-and-attribution). Confirm current installation details and flags there and in `ba --help`; the wire-level credential contract lives in [REST authentication](https://docs.blazingagents.com/api-reference/rest-api/authentication).

## Mistakes and verification

Keep credentials out of shell history, source, and logs. Do not infer coding-agent Skill installation from CLI installation. Verify the resolved executable/version, authentication, help output, and one authenticated request. Interactive use belongs to [chat](chat.md) or [assist](assist.md); automation to [scripting and CI](scripting-and-ci.md).
