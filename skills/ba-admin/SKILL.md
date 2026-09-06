---
name: ba-admin
description: Administer a Blazing Agents tenant from a coding agent using the public TypeScript SDK. Use for BA Tenant settings, Agents, Provider discovery, Workspaces, runtime Skills, Prompts, Tasks and runs, usage, Sessions, or Artifact listings. Do not use for building a BA integration or managing API keys.
metadata:
  author: Blazing Agents
  version: "0.1.0"
---

# BA Admin

Administer the credential-derived Blazing Agents Tenant through the public SDK.
Treat the coding agent and its shell as a trusted administrative environment.
The API key grants Tenant-wide authority; stop if the current environment cannot
be trusted with that authority.

1. Confirm `BLAZING_AGENTS_API_KEY` is present without printing it. Use
   `BLAZING_AGENTS_BASE_URL` when set; otherwise use the SDK default. Stop when
   the key is missing. Never inspect or print the surrounding environment.
2. Read [the TypeScript execution reference](references/typescript.md). Inspect
   the installed SDK's exported types for the exact current input contract of
   the requested operation; the SDK is the source of truth.
3. Resolve names to IDs with a read call. Continue only with one exact match;
   report zero or multiple matches instead of guessing.
4. Before an update, deletion, Skill file replacement, or Skill file deletion,
   state the exact resource and effect. Continue when the user's latest request
   already explicitly authorizes that exact mutation; otherwise ask once.
   Agent and Session deletion also require an explicit Artifact disposition.
5. Execute the smallest SDK program that performs the requested operation.
   Send each mutation once. After an ambiguous network result, read the resource
   to reconcile state instead of repeating the mutation.
6. Verify mutations with a read call when the resource still exists. Report the
   affected IDs and outcome without credential values or secret-bearing input.

Use only public SDK methods backed by `/v1`. The Admin scope is Tenant settings;
Agent, Workspace, Skill, Prompt, and Task management; Provider reads and model
discovery; Task-run observation and cancellation; usage queries; Session reads
and deletion; and Artifact listings. Keep Provider credential mutation, MCP
Connection management, Memory mutation, Artifact deletion/download, generation,
Agent enable/disable or Version restoration, and API-key lifecycle outside this
Skill.
