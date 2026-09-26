# Take your integration to production

Work through this checklist before real users reach your agent. Each item links to a short explanation below with the fix and, where it helps, working code.

## Checklist

- [ ] [The Blazing Agents API key lives only on your backend.](#keep-the-key-on-your-backend)
- [ ] [You know how to rotate the key without downtime.](#rotate-keys)
- [ ] [Your backend creates one client per API key and reuses it.](#one-client-per-credential)
- [ ] [Your backend authorizes every user request; `userId` is only a label.](#attribution-is-not-authorization)
- [ ] [Retries are bounded and only repeat calls that are safe to repeat.](#retry-only-what-is-safe)
- [ ] [Every Task run submission carries an idempotency key.](#submit-task-runs-with-an-idempotency-key)
- [ ] [You log request IDs, error codes, and resource IDs, and nothing secret.](#log-request-ids-for-support)
- [ ] [Sessions and Tasks that must behave the same over time pin an Agent Version.](#pin-agent-versions)
- [ ] [A tenant quota is set with headroom, and your code handles quota outcomes.](#set-quotas-and-handle-quota-outcomes)
- [ ] [Your code handles Stop and Task run cancellation, including side effects that already happened.](#handle-cancellation)
- [ ] [Your code reads limits from the docs instead of hard-coding them.](#respect-limits)

## Keep the key on your backend

A Blazing Agents API key reaches everything in your Tenant: every Agent, Session, Task, and usage record. No key is safe to ship to a browser or mobile app, because the API is backend-only.

- Read the key from `BLAZING_AGENTS_API_KEY` in your server environment or secret manager.
- Keep it out of browser bundles, mobile binaries, public-prefixed variables (`NEXT_PUBLIC_*`, `VITE_*`), URLs, and client-visible errors.
- Your frontend talks to your own backend endpoint. That endpoint signs in the user, checks access, and then calls Blazing Agents.
- Provider keys and MCP credentials are stored by Blazing Agents and never returned. Responses show only a short fragment. The agent's Workspace never sees any of these secrets.

## Rotate keys

Keys are created and revoked only in the dashboard at `https://www.blazingagents.com/app/keys`. An API key cannot create, list, or revoke keys, and the SDKs have no key-management methods.

1. Create a new key. The full `ba_...` value appears once, so copy it right away.
2. Deploy it to every backend instance.
3. Confirm the workload runs on the new key.
4. Revoke the old key. Revocation takes effect immediately.

Name each key for one workload or environment, such as `Production API`, so you know what breaks when you revoke it. A key with an expiration stops working the same way a revoked key does, so track expiry dates.

Provider keys cannot be changed in place. To rotate one, create a new Provider, move your Agents to it by sending `providerId` and `model` together, then delete the old Provider. Pinned Versions, Sessions, and Tasks that still name the old Provider block deletion with `provider_historical_use`; see [troubleshooting](troubleshooting.md#provider-credential-rejected).

## One client per credential

Create the client once per API key, at module scope, and import it wherever you call Blazing Agents. Creating a client makes no network request, so there is no warm-up cost, but a single shared instance keeps your key handling and response logging in one place.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
if (!apiKey) throw new Error("Set BLAZING_AGENTS_API_KEY");

export const client = new BlazingAgents({
  apiKey,
  onResponse({ method, path, status, durationMs, requestId }) {
    console.log({ method, path, status, durationMs, requestId });
  },
});
```

```python
from blazing_agents import BlazingAgents, ResponseObservation


def log_response(response: ResponseObservation) -> None:
    print(
        {
            "method": response.method,
            "path": response.path,
            "status": response.status,
            "duration_ms": response.duration_ms,
            "request_id": response.request_id,
        }
    )


client = BlazingAgents(on_response=log_response)
```

The Python client reads `BLAZING_AGENTS_API_KEY` and raises `ValueError` when it is missing. Close it on shutdown with `client.close()`, or use `with BlazingAgents() as client:` in scripts.

To tag one request with your own correlation ID, derive a copy with `client.withOptions({ clientRequestId })` (`client.with_options(client_request_id=...)` in Python). The original client is unchanged.

## Attribution is not authorization

Your API key identifies your Tenant, not your end user. A `userId` and `metadata` you pass on a turn, Session, or Task are Attribution: labels for filtering Sessions and breaking down usage. They grant nothing.

- Sign in the user and check what they may access in your backend before every Blazing Agents call.
- Record which of your users started each `ss_...` Session in your own database, and check it before you resume a Session or read its messages.
- Never accept a Session ID, Agent ID, or `userId` from the browser without checking it against the signed-in user.
- The `userId` on a Session is fixed after its first turn. A Task run snapshots the Task's `userId` and `metadata` when it is queued.

For per-user Sessions and dashboards, read [multi-user apps](recipes/multi-user-apps.md).

## Retry only what is safe

The SDKs never retry for you. An error entry saying "retrying can succeed" tells you the cause may be temporary. It does not tell you the retry is safe, because a request that timed out may already have taken effect.

| Operation | Safe to repeat? |
| --- | --- |
| Reads (`get`, `list`, `messages`, `usage`) | Yes. |
| Starting a Task run with the same idempotency key | Yes. You get the same run back. |
| Cancelling a Task run | Yes. Cancelling a finished run does nothing and returns no error. |
| Sending the same tool approval decision | Yes. Sending the opposite decision returns `tool_approval_decision_conflict`. |
| Joining a tool approval continuation | Yes. Joining again never runs the tool a second time. |
| Sending a chat message again | It starts a new turn. Tools with side effects, such as sending an email, can run again. |
| Creating an Agent, Provider, Prompt, or other resource | No. On a lost response, list the resources first; a `*_name_conflict` error often means the first attempt worked. |

Retry these codes with backoff, jitter, and an overall deadline, and honor the `Retry-After` header when present (`error.headers` in TypeScript, `error.retry_after` in Python): `rate_limited`, `session_busy`, `session_version_mismatch`, `task_active_run_exists`, `workspace_busy`, `internal`, `service_unavailable`, `model_validation_unavailable`, `mcp_connection_unreachable`, `mcp_connection_discovery_failed`. Fix the request for every other code. See [troubleshooting](troubleshooting.md) for each one.

## Submit Task runs with an idempotency key

Networks drop responses, so your code may resubmit a run that already started. Pass an idempotency key built from a stable business fact, such as the report date. Every submission with the same key returns the same run.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const taskId: string;

export async function submitDailyReport(day: string): Promise<string> {
  const { runId } = await client.tasks.createRun({
    taskId,
    idempotencyKey: `daily-report:${day}`,
  });
  return runId;
}
```

```python
from blazing_agents import BlazingAgents


def submit_daily_report(client: BlazingAgents, task_id: str, day: str) -> str:
    submission = client.tasks.submit(task_id, idempotency_key=f"daily-report:{day}")
    return submission.run_id
```

- Save the run ID with the key before you return, so a later poll finds it.
- A Task runs one job at a time. A different key while a run is queued or running returns `task_active_run_exists` (HTTP 409).
- A Task run's turn executes at most once. If the platform restarts mid-run, an unfinished turn ends as `failed` instead of running the model and tools again.
- At most once is not exactly once for the outside world. A `failed` run may already have called a tool. Check for its effects before you submit the work again with a new key.
- Poll until the run reaches `succeeded`, `failed`, `canceled`, or `blocked`, and alert when a run stays `queued` or `running` past your deadline.

For the full Task flow, read [background and scheduled work](recipes/background-and-scheduled.md).

## Log request IDs for support

Every response carries an `X-Request-Id` header. It is not in the JSON body. Read it from `error.requestId` (`error.request_id` in Python), from `result.requestId` on a generation result, or from the `onResponse` hook shown above.

- Log the HTTP status, error `code`, request ID, and the IDs of the Agents, Sessions, Tasks, and runs involved.
- Leave out credentials, `Authorization` headers, prompts, message content, tool input and output, and artifact download URLs. Error messages and a Task run's `error` text can contain user content, so redact them first.
- Include the request ID when you contact support.
- A request ID identifies one attempt. Each retry gets a new one. It is never an idempotency key.
- Use `clientRequestId` to tie Blazing Agents requests to your own trace or order ID.

## Pin Agent Versions

Every Agent update saves a new numbered Agent Version. Calls without a version use the latest one at the moment the turn starts, so an edit changes behavior for every caller immediately.

- **Sessions:** pass `version` on the first `client.chat()` call. Every turn in that Session uses it, and the pin cannot change later.
- **Stateless generation:** pass `version` on each `completion()` or `object()` call.
- **Tasks:** set `agentVersion` on the Task. Each run records the version it actually used.
- **Usage:** each turn's usage record shows the version that ran, so you can compare versions.

A Version stores references, not copies. The Provider key, MCP credentials, Workspace, Skills, and Memories always use their current state, even for a pinned Version. Deleting a Provider that a pinned Version names makes that Version fail with `provider_not_found`.

To roll back a bad edit, call `client.agents.restoreVersion({ agentId, version })` (`restore_version` in Python). It copies the old configuration into a new latest Version.

## Set quotas and handle quota outcomes

A tenant quota sets a monthly token ceiling, a request ceiling, or both, with a reset day from 1 to 28. Set it with `client.tenant.patch()` (`client.tenant.update()` in Python). With no quota, usage is unlimited.

- Blazing Agents checks the quota before each turn starts. It does not stop a turn that crosses the ceiling while running, and concurrent turns can overshoot. Leave headroom.
- A chat or generation call over the ceiling fails with `quota_exceeded` (HTTP 429). Show your user a clear message; retrying before the reset fails the same way.
- A Task run over the ceiling ends as `blocked`, not `failed`, and never runs. Treat `blocked` as its own outcome in your alerts.
- A missing plan or used-up usage credit returns `subscription_required` or `usage_credit_required` (HTTP 402) for chat and generation, and ends a Task run as `blocked`.
- Too many interactive turns at once returns `rate_limited` (HTTP 429). Extra Task runs wait as `queued` instead.
- Failed and cancelled turns are metered too. Keep them in your usage reports.

For per-user usage reporting, read [usage dashboards](recipes/usage-dashboards.md).

## Handle cancellation

Cancellation asks work to stop. It never undoes what already happened.

- **Chat Stop:** pass your incoming request's `abortSignal` to `client.chat()` so a user's Stop ends the stream and asks Blazing Agents to cancel the turn. A cancelled turn adds nothing to the Session history, but the exchange may already have been saved before the Stop arrived, so reload history instead of guessing. Keep the user's draft so they can resend.
- **Task runs:** `client.tasks.cancelRun({ taskId, runId })` (`cancel_run` in Python) asks the run to stop at its next safe point. Keep polling until it reaches a final status. It may finish first, so handle `succeeded` as well as `canceled`.
- **Time limits:** a run that hits its time limit stops and ends as `failed`.
- **Side effects:** a Workspace command or file operation that already started may finish after cancellation. Files it changed and effects on remote systems stay. Plan to clean up or reverse them yourself.
- **Disconnects:** closing the connection to a tool approval continuation does not stop it. Join the same `continuationId` again to keep reading.

## Respect limits

Resource counts, text and upload sizes, schedule intervals, usage windows, page sizes, and concurrency all have limits, and they change. Read the current values in [service limits](https://docs.blazingagents.com/api-reference/protocols/service-limits) instead of copying numbers into your code.

- Treat pagination cursors as opaque. Pass `nextCursor` back to the same call with the same filters.
- Validate user input against the documented sizes before you send it, so your users see your message instead of `validation_failed`.

## Go deeper

- [Limits and reliability](https://docs.blazingagents.com/platform/limits-and-reliability)
- [Security and credentials](https://docs.blazingagents.com/platform/security-and-credentials)
- [Tenancy and end-user attribution](https://docs.blazingagents.com/platform/tenancy-and-attribution)
- [Usage and quotas](https://docs.blazingagents.com/platform/usage-and-quotas)
- [Versions and lifecycle](https://docs.blazingagents.com/agents/versions-and-lifecycle)
- [Task runs](https://docs.blazingagents.com/automation/task-runs)
- [Errors](https://docs.blazingagents.com/api-reference/protocols/errors)
- [Service limits](https://docs.blazingagents.com/api-reference/protocols/service-limits)
