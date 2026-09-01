# Limits and reliability

Limits, errors, retry signals, idempotency behavior, and recovery details are volatile contracts. Look them up before designing an integration's failure policy.

## Decision and workflow

1. Identify the exact operation and whether it is safe or idempotent to repeat.
2. Inspect current limits, error, and request-correlation references.
3. Bound retries, preserve caller-owned correlation, and reconcile durable resources after ambiguous outcomes.

Read [Limits and reliability](https://docs.blazingagents.com/platform/limits-and-reliability), [service limits](https://docs.blazingagents.com/api-reference/protocols/service-limits), and [errors](https://docs.blazingagents.com/api-reference/protocols/errors).

## Mistakes and verification

Avoid blanket retries, stale copied limits, and treating request IDs as idempotency keys. Verify timeout, cancellation, retryable and terminal errors, duplicate-attempt behavior, and recovery. Task-specific durability belongs to [Task runs](../automation/task-runs.md).
