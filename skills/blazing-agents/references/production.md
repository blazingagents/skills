# Take your integration to production

For a Python, Rust, or Go backend, read this page's code examples in [Python](production.python.md), [Rust](production.rust.md), [Go](production.go.md).

Work through this checklist before real users reach your agent. Each item links to a short explanation below with the fix and, where it helps, working code.

## Checklist

- [ ] [The Blazing Agents API key lives only on your backend.](#keep-the-key-on-your-backend)
- [ ] [A backend that only chats, runs Tasks, and reads uses a read key.](#use-a-read-key-where-you-can)
- [ ] [You know how to rotate the key without downtime.](#rotate-keys)
- [ ] [Your backend creates one client per API key and reuses it.](#one-client-per-credential)
- [ ] [Your backend derives user scope from verified sign-in.](#attribution-is-not-authorization)
- [ ] [Retries are bounded and only repeat calls that are safe to repeat.](#retry-only-what-is-safe)
- [ ] [Every Task run submission carries an idempotency key.](#submit-task-runs-with-an-idempotency-key)
- [ ] [You log request IDs, error codes, and resource IDs, and nothing secret.](#log-request-ids-for-support)
- [ ] [Your rollout plan accounts for Agent edits reaching only new work.](#agent-edits-reach-new-work-only)
- [ ] [A model spending limit is set with headroom, and your code handles limit outcomes.](#set-a-spending-limit-and-handle-limit-outcomes)
- [ ] [Your code handles Stop and Task run cancellation, including side effects that already happened.](#handle-cancellation)
- [ ] [Your design fits the limits, and your code does not hard-code them.](#respect-limits)

## Keep the key on your backend

A Blazing Agents API key reaches everything in your Tenant: every Agent, Session, Task, and usage record. No key is safe to ship to a browser or mobile app, because the API is backend-only.

- Read the key from `BLAZING_AGENTS_API_KEY` in your server environment or secret manager.
- Keep it out of browser bundles, mobile binaries, public-prefixed variables (`NEXT_PUBLIC_*`, `VITE_*`), URLs, and client-visible errors.
- Your frontend talks to your own backend endpoint. That endpoint signs in the user, checks access, and then calls Blazing Agents.
- Provider keys and MCP credentials are stored by Blazing Agents and never returned. Responses show only a short fragment. The agent's Workspace never sees any of these secrets.

## Use a read key where you can

Each key is read (`ba_read_...`) or full (`ba_full_...`), chosen when it is created and never changed. A read key can read everything and run Agents, chat, and Tasks, but cannot create, change, or delete anything; such a call fails with `insufficient_scope` (403). It still spends credit and creates Sessions. Give the backend that serves your users a read key, and keep a full key for setup code and deploy scripts that create Agents, Skills, Tasks, or other resources. A leaked read key cannot rewrite your Agents.

## Rotate keys

Keys are created and revoked only in the dashboard at `https://www.blazingagents.com/app/keys`. An API key cannot create, list, or revoke keys, and the SDKs have no key-management methods.

1. Create a new key with the same access level. The full value appears once, so copy it right away.
2. Deploy it to every backend instance.
3. Confirm the workload runs on the new key.
4. Revoke the old key. Revocation takes effect immediately.

Name each key for one workload or environment, such as `Production API`, so you know what breaks when you revoke it. A key with an expiration stops working the same way a revoked key does, so track expiry dates.

Provider keys cannot be changed in place. To rotate one, create a new Provider, move your Agents to it by sending `providerId` and `model` together, then delete the old Provider. Saved Sessions and queued or running Task runs that still name the old Provider block deletion with `provider_historical_use`. Move them first, or delete with `confirmSnapshotInvalidation: true` and accept that work needing the deleted Provider then fails with `provider_not_found`; see [troubleshooting](troubleshooting.md#provider-credential-rejected).

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

The Python client reads `BLAZING_AGENTS_API_KEY` and raises `ValueError` when it is missing. Close it on shutdown with `client.close()`, or use `with BlazingAgents() as client:` in scripts. The Go client fails `ba.NewClient()` with `ba.ErrMissingAPIKey` or `ba.ErrInvalidAPIKey`, so a bad key is caught at startup; `ba.WithLogger(logger)` writes one `slog` Debug record per response instead of an observer.

To tag one request with your own correlation ID, derive a copy with `client.withOptions({ clientRequestId })` (`client.with_options(client_request_id=...)` in Python, `client.with_client_request_id(...)` in Rust, `client.WithClientRequestID(...)` in Go). The original client is unchanged.

## Attribution is not authorization

Your API key identifies your Tenant, not your end user. A `userId` and `metadata` you pass on a turn, Session, or Task are Attribution: labels for filtering Sessions and breaking down usage. They grant nothing.

- Authenticate each request and run every call made for a signed-in user on the End-user scoped client: `client.forUser(verifiedUserId)` in TypeScript, `client.for_user(verified_user_id)` in Python, `client.for_user(verified_user_id)?` in Rust, `client.ForUser(verifiedUserID)` in Go. That covers chat, approvals, history, Session inputs and Stop, Artifacts, Memories, the user's usage, and Task runs for that user. BA checks ownership on reads and writes: another user's resource returns `not_found` (404), and a conflicting `userId` fails with `invalid_request` (400).
- Keep Tenant administration (Providers, connections, spending limits, usage across all users) on the unscoped client in trusted backend code. A scoped client cannot reach it; such a request fails with `forbidden` (403).
- Derive the scope from your verified session. A browser-supplied header or `userId` is not proof of identity.
- If an integration uses an unscoped client, keep its own resource access checks. A list filter does not restrict later reads by ID.
- The `userId` on a Session is fixed after its first turn. A Task run snapshots the Task's `userId` and `metadata` when it is queued.

For per-user Sessions and dashboards, read [multi-user apps](recipes/multi-user-apps.md).

## Retry only what is safe

The SDKs never retry for you, except backend-function claim and result submissions. An error entry saying "retrying can succeed" tells you the cause may be temporary. It does not tell you the retry is safe, because a request that timed out may already have taken effect.

| Operation | Safe to repeat? |
| --- | --- |
| Reads (`get`, `list`, `messages`, `usage`) | Yes. |
| Creating a Task with the same idempotency key and unchanged input | Yes, including the original initial run when `submit: true`. |
| Starting a Task run with the same idempotency key | Yes. You get the same run back. |
| Cancelling a Task run | Yes. Cancelling a finished run does nothing and returns no error. |
| Continuing an approval round with the same decisions | Yes. Identical decisions are idempotent; the first `reason` wins. A changed decision returns `tool_approval_decision_conflict`, a running round returns `session_busy`, and a settled round returns `tool_approval_continuation_settled` without running again. |
| Sending a chat message again | It starts a new turn. Tools with side effects, such as sending an email, can run again. A message ID already in history returns `message_id_conflict` (409) before model or Tool work; regeneration may reuse IDs. |
| Forking a Session with the same explicit idempotency key and selected message | Yes. It returns the same child. Reuse the original key after a lost response; changing the message returns `idempotency_conflict`. A deleted child returns `session_fork_deleted`. |
| Submitting a Session input (steer) with the same `requestId` and unchanged message | Yes. You get the same receipt back. A changed message returns `input_idempotency_conflict`. |
| Stopping the same Turn again | Yes. Stop names the Turn, so a repeat never stops a later Turn. |
| Creating another resource, or a Task without a key | No. Reconcile a lost response before retrying. Agent and Prompt names can repeat, so a name match alone cannot identify the created resource. |

Retry these codes with backoff, jitter, and an overall deadline, and honor the `Retry-After` header when present (`error.headers` in TypeScript): `rate_limited`, `session_turn_unresponsive`, `session_version_mismatch`, `task_active_run_exists`, `workspace_busy`, `internal`, `service_unavailable`, `model_validation_unavailable`, `mcp_connection_unreachable`, `mcp_connection_discovery_failed`. For `session_turn_unresponsive`, wait the whole seconds in `Retry-After`, which is at most a minute. A retry sent earlier fails the same way. Retry `session_busy` only when its `details.reason` is `turn_running`, or steer the Turn instead; `approval_pending` and `continuation_waiting` never clear by waiting, so decide the approval round with `continueChat` first. Fix the request for every other code. See [troubleshooting](troubleshooting.md) for each one.

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

- Save the run ID with the key before you return, so a later poll finds it.
- A Task runs one job at a time. A different key while a run is queued or running returns `task_active_run_exists` (HTTP 409).
- A Task run's turn executes at most once. If the platform restarts mid-run, an unfinished turn ends as `failed` instead of running the model and tools again.
- At most once is not exactly once for the outside world. A `failed` run may already have called a tool. Check for its effects before you submit the work again with a new key.
- Poll until the run reaches `succeeded`, `failed`, `canceled`, or `blocked`, and alert when a run stays `queued` or `running` past your deadline.
- This sample is a trusted Tenant job, so it uses the unscoped client. Submit, poll, and cancel the runs of a Task you created for one user through that user's scoped client.

For the full Task flow, read [background and scheduled work](recipes/background-and-scheduled.md).

## Log request IDs for support

Every response carries an `X-Request-Id` header. It is not in the JSON body. Read it from `error.requestId` (`error.request_id` in Python, `error.request_id()` in Rust, `apiErr.Meta.RequestID` in Go), from `result.requestId` on a generation result, or from the `onResponse` hook shown above (`on_response` in Rust, `ba.WithObserver` or a per-call `ba.CaptureResponse` in Go).

- Log the HTTP status, error `code`, request ID, and the IDs of the Agents, Sessions, Tasks, and runs involved.
- Leave out credentials, `Authorization` headers, prompts, message content, tool input and output, and artifact download URLs. Error messages and a Task run's `error` text can contain user content, so redact them first.
- Include the request ID when you contact support.
- A request ID identifies one attempt. Each retry gets a new one. It is never an idempotency key.
- Use `clientRequestId` to tie Blazing Agents requests to your own trace or order ID.

## Agent edits reach new work only

An edit to an Agent's model, instructions, tools, approval policies, or compaction settings applies to new Sessions, Task runs queued after the edit, and stateless calls. An existing Session keeps the configuration from its first Turn, and a queued Task run keeps the one from when it was queued. To roll a change out to users mid-conversation, start them a new Session. Because saved Sessions keep their Provider, deleting a Provider they name fails with `provider_historical_use`; see [Rotate keys](#rotate-keys).

When a Session or run behaves as if an edit never happened, read the configuration it used from trusted backend code: `(await client.sessions.get({ agentId, sessionId })).agentConfig` or `(await client.tasks.getRun({ taskId, runId })).agentConfig`. Provider keys, MCP credentials, Skills, Memories, and the Workspace are always current.

## Set a spending limit and handle limit outcomes

A model spending limit is an estimated dollar allowance for one Agent or the whole Tenant, with a reset schedule. Set it with `client.tenant.updateSpendingLimit()` or `client.agents.updateSpendingLimit()`. With no limit, spending is unlimited.

- Blazing Agents checks the limit before each model request. A running turn can finish one request past it, and concurrent turns can overshoot. Leave headroom.
- A Task run refused by a limit, your plan or your usage credit ends as `blocked`, not `failed`, and never runs. Treat `blocked` as its own outcome in your alerts.
- A model spending limit returns `model_spending_limit_exceeded` (HTTP 429) before streaming, or a `data-ba-error` part with that code when it stops a chat mid-stream. Show the user when it resets and never retry automatically; see [chat in your app](recipes/chat-in-your-app.md) and [model spending limits](recipes/usage-dashboards.md#model-spending-limits).
- Without an active plan, almost every API call returns `subscription_required` (HTTP 402), reads included; only stopping a Turn and cancelling a Task run still work. Used-up usage credit returns `usage_credit_required` (HTTP 402) for a Turn. Both end a Task run as `blocked`.
- Too many interactive turns at once returns `rate_limited` (HTTP 429) with no `Retry-After`; stateless calls share that limit. Extra Task runs wait as `queued` instead.
- Failed and cancelled turns are metered too. Keep them in your usage reports.

For per-user usage reporting, read [usage dashboards](recipes/usage-dashboards.md).

## Handle cancellation

Cancellation asks work to stop. It never undoes what already happened.

- **Chat Stop:** pass your incoming request's `abortSignal` to the user's scoped `chat()` call, `client.forUser(verifiedUserId).chat()` (in Go, the request's `ctx`), so a user's Stop ends the stream and asks Blazing Agents to cancel the turn. A cancelled turn adds nothing to the Session history, but the exchange may already have been saved before the Stop arrived, so reload history instead of guessing. Keep the user's draft so they can resend.
- **Stop by Turn ID:** `sessions.stop()` on the user's scoped client (`sessions.stop()` in Python, `sessions().stop()` in Rust, `Sessions.Stop()` in Go) records cancellation for the named Turn and returns `{ stoppedTurnId, activity }` immediately. The client that started the Turn has its ID from `ChatResult.turnId` (`stream.turn_id` in Python, `stream.turn_id()` in Rust, `stream.TurnID()` in Go); any other client reads it from the Session's `activity` (in Rust and Go, `activity` comes back from the inputs list, submit input, or stop call). Keep reading the existing stream until the Turn settles. Messages waiting in your client's own queue still need a send. A steered message the agent already read may have had effects even though the stopped Turn is not saved; its receipt ends `not_placed`, and sending it again as chat can repeat those effects. Stop never decides a pending tool approval.
- **Task runs:** `tasks.cancelRun({ taskId, runId })` (`cancel_run` in Python, `tasks().cancel_run()` in Rust, `Tasks.CancelRun()` in Go), on the scoped client for a user's run, asks the run to stop at its next safe point. Keep polling until it reaches a final status. It may finish first, so handle `succeeded` as well as `canceled`.
- **Time limits:** a run that hits its time limit stops and ends as `failed`.
- **Side effects:** a Workspace command or file operation that already started may finish after cancellation. Files it changed and effects on remote systems stay. Plan to clean up or reverse them yourself.
- **Disconnects:** closing a chat or continuation stream does not prove the turn stopped. Repeat `continueChat`/`continue_chat` with the same decisions to recover a dropped continuation, then reload history. A running round returns `session_busy` and a settled one returns `tool_approval_continuation_settled`. For an ordinary turn, pass the request's `abortSignal`, expect a disconnect to cancel the turn, and reload history, because the stream cannot be reconnected. A stream that ends with a `data-ba-error` part with code `turn_interrupted` was cut by the platform, not by a disconnect. The turn may have saved its work, and the Session can stay busy for up to a minute, so reload history before you resend.

## Respect limits

Check the design against [Limits](limits.md) before launch: concurrency, the 30-minute Turn deadline, the 30-second shell command limit, the creation rate for per-user Agents, and the shared Memory pool. Limits can change, so do not hard-code them in your code; validate against the values on [service limits](https://docs.blazingagents.com/api-reference/protocols/service-limits) and handle the error when one is reached.

- Treat pagination cursors as opaque. Pass `nextCursor` back to the same call with the same filters.
- Validate user input against the documented sizes before you send it, so your users see your message instead of `validation_failed`.

## Go deeper

- [Limits and reliability](https://docs.blazingagents.com/platform/limits-and-reliability)
- [Security and credentials](https://docs.blazingagents.com/platform/security-and-credentials)
- [Tenancy and end-user attribution](https://docs.blazingagents.com/platform/tenancy-and-attribution)
- [Usage and spending limits](https://docs.blazingagents.com/platform/usage-and-spending-limits)
- [Configuration snapshots and lifecycle](https://docs.blazingagents.com/agents/configuration-snapshots)
- [Task runs](https://docs.blazingagents.com/automation/task-runs)
- [Errors](https://docs.blazingagents.com/api-reference/protocols/errors)
- [Service limits](https://docs.blazingagents.com/api-reference/protocols/service-limits)
