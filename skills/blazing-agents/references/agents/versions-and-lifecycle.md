# Versions and lifecycle

An Agent Version is an immutable record of versioned Agent configuration. Agent status controls whether new Turns may start. Use Versions for pinning, audit, comparison, and restore.

## Decision and workflow

1. Determine whether a mutation changes versioned configuration or current lifecycle/attachment state.
2. Pin a Version when reproducibility matters; otherwise use current configuration.
3. Restore through the supported operation, which creates a new latest Version.

Read [Versions and lifecycle](https://docs.blazingagents.com/agents/versions-and-lifecycle), [run a background Task](https://docs.blazingagents.com/automation/tasks), and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/agents), [Python](https://docs.blazingagents.com/sdk/python/agents), or [REST](https://docs.blazingagents.com/api-reference/rest-api/agents) Agent references.

## Mistakes and verification

Preserve immutable history and distinguish lifecycle changes from configuration changes. Verify status, latest Version, and any pinned execution path. Task pinning belongs to [Tasks](../automation/tasks.md).
