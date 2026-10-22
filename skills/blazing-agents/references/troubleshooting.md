# Troubleshoot a Blazing Agents integration

For a Python, Rust, or Go backend, read this page's code examples in [Python](troubleshooting.python.md), [Rust](troubleshooting.rust.md), [Go](troubleshooting.go.md).

Find the symptom, read the likely cause, and apply the fix. Every failed request carries a stable error `code` and an HTTP status; branch on the code, never on the message text.

## Read the error first

Every SDK failure is a `BlazingAgentsError` in TypeScript. In Python, an error response raises `APIStatusError`, a network failure raises `APIConnectionError` (or its subclass `APITimeoutError`), and a failure after a stream starts raises `StreamError`. In Rust, every failure is one `blazing_agents::Error` variant: `Api` for an error status, `Connection` or `Timeout` before a response, `Stream` after headers arrive. In Go, match with `errors.As`: `*ba.APIError` for an error status, `*ba.ConnectionError` or `*ba.TimeoutError` before a response, `*ba.StreamError` after headers arrive. Log the code, status, and request ID before you decide anything.

```ts
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const agentId: string;

export async function readAgent() {
  try {
    return await client.agents.get({ agentId });
  } catch (error) {
    if (!BlazingAgentsError.isInstance(error)) throw error;
    console.error({
      code: error.code,
      status: error.status,
      requestId: error.requestId,
      agentId,
    });
    throw error;
  }
}
```

Use `BlazingAgentsError.isInstance(error)` instead of `instanceof`, which fails when two copies of the package are installed. Treat `error.code` as an open string: new codes can appear. In Go, `apiErr.Code` is a `ba.ErrorCode` with a constant per documented code (`ba.ErrorCodeNotFound`), and an unknown code compares as itself. The TypeScript SDK adds four codes of its own: `network_error`, `request_aborted`, `stream_error`, and `invalid_response`.

## Symptom table

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `unauthorized` (401) | Missing, mistyped, revoked, or expired API key, or a dashboard-only call made with an API key. | [Replace the key](#401-unauthorized). |
| 403 | `merchant_customer_unmapped`: your monetization guard found no customer for the turn's `userId`. `forbidden`: a scoped client called a Tenant-only operation. `insufficient_scope`: a read-only key tried to create, change, or delete part of your setup, or to steer a turn a full key started. | [Link the user, use an unscoped client, or use a full key](#403-responses). |
| `not_found` (404) for an ID you just created | The key is for a different Tenant, the ID is wrong, or an End-user scoped client asked for another user's resource. | [Check the key's Tenant](#404-for-a-resource-you-can-see-in-the-dashboard). |
| `provider_required` (400) | The saved Agent configuration has no Provider and model. | [Set a Provider and model](#agent-without-a-provider-or-model). |
| `model_not_found` (400) or `model_validation_unavailable` (503) | The model ID is not in the Provider's list, or the Provider could not be reached or rejected the stored key. | [Fix the model or the Provider](#provider-credential-rejected). |
| Turn fails right after it starts, no code | The Provider rejected the stored key or the request during the turn. | [Replace the Provider](#provider-credential-rejected). |
| `quota_exceeded` (429), or a Task run ends `blocked` | Usage in the current window is at or above your tenant quota. | [Wait for reset or raise the quota](#quota-blocked). |
| `model_spending_limit_exceeded` (429), a `data-ba-error` part with that code in a chat stream, or a Task run ends `blocked` with a spending-limit `error` | The Agent's or the account's model spending limit has nothing left this period. | [Wait for the reset or change the limit](#quota-blocked). |
| `subscription_required` or `usage_credit_required` (402) | No active plan, or no usage credit left. | [Fix billing](#quota-blocked). |
| `rate_limited` (429) | Too many interactive turns at once, or resources created too fast. | [Back off](#quota-blocked). |
| `session_busy` (409) | Read `details.reason`: `turn_running` (another turn holds the Session), `approval_pending`, or `continuation_waiting`. | [Steer or wait for `turn_running`; decide the approval round for the others](#session-busy). |
| `tenant_deleting` (409) | Account deletion is scheduled. New turns and Task runs are refused and queued runs are cancelled. | Cancel the deletion in the dashboard within 24 hours to resume service. |
| `session_turn_unresponsive` (409) | The Session's previous turn stopped responding and still holds the Session. The Session frees within a minute. | [Wait for `Retry-After`, read the history, then resend under a new message ID](#session-busy). |
| Chat paused for approval never continues after the decisions | Nothing runs until a client sends the complete round's decisions; a partial set fails `validation_failed`. | Send the whole round in one `continueChat`/`continue_chat` call, with the chat's `functions`; see [backend functions](recipes/backend-functions.md). |
| `tool_approval_continuation_settled` (409) on a continuation call | The approval round already ran to a terminal state. | Read the Session's messages instead of deciding again. |
| `session_version_mismatch` (409) | Two turns ran on the same Session at once; this one was not saved. | [Send one turn at a time](#session-busy). |
| `input_idempotency_conflict` (409) | A Session input reused a `requestId` with a different message, or reused a message ID under a new `requestId`. | [Retry with the original request](#session-input-errors). |
| `message_id_conflict` (409) on chat | The submission contains a message ID already in accepted history; nothing ran. | The message is already saved; reload history instead of resending. Regeneration may reuse IDs. |
| `steer_not_available` (409) on a Session input | No Turn can take a steer: the Session is idle or stopping, or an approval is waiting. | [Hold the message and send it as chat](#session-input-errors). |
| A message sent while a turn ran never reaches the agent | BA holds no queue; the message was still waiting in the client. | [Send waiting messages after the turn settles](#session-input-errors). |
| `invalid_cursor` (400) | The cursor was altered, came from another list, or was reused with different filters. | [Restart pagination](#invalid-cursor). |
| Tool call never runs; the agent reports it was denied | The approval policy for this surface is `deny`, or `manual`/`auto` in a Task or stateless generation, where no person can approve. | [Change the policy or use chat](#tool-blocked-by-approval-policy). |
| Turn fails with `mcp_connection_discovery_failed` (502), or the connection shows `needs_auth` | An attached MCP connection needs OAuth sign-in, or its server is down. | [Finish sign-in or detach](#mcp-authorization-missing). |
| Chat stream ends without a `finish` chunk, ends with a `data-ba-error` part with code `turn_interrupted`, or `stream_error` | The stream broke after it started: network drop, server error, a turn the platform cut, or your Stop. | [Reload history and let the user resend](#stream-ended-without-finish). |
| Slack or Telegram bot stays silent; a health check shows `unknown` | The health check could not verify a setting. | [Check that setting by hand](#chat-connection-health-unknown). |

For any code not listed here, open its entry in the [error catalog](https://docs.blazingagents.com/api-reference/protocols/errors). Each entry says whether retrying the same request can succeed.

## 401 unauthorized

The `Authorization` header is missing, or the key in it is revoked, expired, or mistyped.

- Check that your backend reads `BLAZING_AGENTS_API_KEY` from the environment you expect, and that the full `ba_...` value was copied.
- Create a new key in the dashboard at `https://www.blazingagents.com/app/keys`, deploy it, then revoke the old one. Blazing Agents cannot show an existing key again.
- Dashboard-only operations, such as creating API keys, starting checkout, or starting OAuth sign-in for an MCP connection, also return `unauthorized` with an API key. Do those in the dashboard.
- Retrying unchanged fails the same way.

## 403 responses

A bad API key is always `unauthorized` (401), never 403. A 403 has one of three codes:

- `merchant_customer_unmapped`: your monetization guard is on and the Turn's `userId` has no linked billing customer. Link the `userId` to a customer in your billing provider, then start the turn again. If you did not intend to bill per user, turn off the guard. A Task run in this state ends `blocked`.
- `forbidden`: a scoped request tried an operation outside end-user scope, such as Tenant settings or spending limits. Make that call from an unscoped client in trusted backend code.
- `insufficient_scope`: the API key is read-only (`ba_read_...`) and the call creates, changes, or deletes an Agent, Skill, Prompt, Workspace, Task, Provider, or other setting, or steers a turn a full key started. Read-only keys can still read, chat, run Tasks, and call generation. The request was refused before it ran, so nothing changed. Use a full key (`ba_full_...`); a key's level cannot be changed, so create a new full key in the dashboard if you need one.

## 404 for a resource you can see in the dashboard

`not_found` means the resource does not exist in the Tenant your key is for. Blazing Agents gives the same answer for a wrong ID, a deleted resource, and another Tenant's resource.

- Check the ID's prefix, such as `ag_` or `ss_`.
- Check that the key is for the same Tenant as the dashboard you are looking at.
- Resuming a Session through a different Agent also returns `not_found`. Each Session is tied to one Agent.
- An End-user scoped client gets `not_found` for every resource that user does not own, such as another user's Session or Artifact (`workspace_not_found` for a Workspace). A scoped chat needs an Agent created with that user's `userId` and, when the Agent has a Workspace, a Workspace created with the same `userId`. Check the scope ID you pass to `forUser` (`for_user`, `ForUser`) and the `userId` the Agent and Workspace were created with.
- A scoped request whose body carries a different `userId` fails with `invalid_request` (400). Omit `userId`; the scope supplies it.

## Agent without a Provider or model

`provider_required` (400) means the Agent configuration that would run has no Provider and model. Nothing ran and nothing was billed.

- Update the Agent with a `providerId` and a `model` the Provider offers. Changing `providerId` without `model` in the same update is rejected; changing only `model` keeps the current Provider.
- An existing Session keeps its saved configuration. Update the Agent and start a new Session. A queued Task run keeps the configuration saved when queued.
- `agent_disabled` (409) means the Agent is disabled. Enable it.

## Provider credential rejected

A Provider's key, type, and base URL are fixed after creation. When the key stops working, you replace the Provider.

- **When you save an Agent or list models:** `model_validation_unavailable` (503) means Blazing Agents could not get a usable model list. The Provider may be down, or it rejected the stored key. Retry once after a short wait; if it persists, the key is the likely cause.
- **When you save an Agent:** `model_not_found` (400) means the model ID is not in the Provider's current list. Check the spelling and prefix, such as `openai/`.
- **During a turn:** a rejection surfaces as an `error` chunk in the chat stream, as `stream_error` when you await a completion, or as a Task run that ends `failed` with text in its `error` field. There is no dedicated error code.

To fix it:

1. Create a new Provider with a working key.
2. Update each Agent with the new `providerId` and `model` together.
3. Delete the old Provider. `provider_in_use` (409) lists Agents still on it in `details.agentIds`. `provider_historical_use` (409) lists saved Sessions and queued or running Task runs in `details.sessionIds` and `details.taskRunIds`. Move those first, or delete with `confirmSnapshotInvalidation: true` (`confirm_snapshot_invalidation=True` in Python, `.confirm_snapshot_invalidation(true)` in Rust, `ConfirmSnapshotInvalidation: new(true)` in Go) and accept that work needing the deleted Provider then fails with `provider_not_found`.

## Quota blocked

- `quota_exceeded` (429): usage in the current window reached the tenant quota you set, so the turn did not start. A Task run in the same situation ends as `blocked`, not `failed`. Wait for the reset day, or raise or remove the quota with `client.tenant.patch()` (`client.tenant.update()` in Python, `client.tenant().update()` in Rust, `client.Tenant.Update()` in Go). Retrying before the reset fails the same way.
- `model_spending_limit_exceeded` (429): a model spending limit stopped the turn. `error.details` holds the `scope` (`agent`, `tenant`, or `both`), the `reason` (`exhausted`, or `unpriced` when the model has no price or a response's cost was not reported), and `nextResetAt`. Show those to the user and never retry automatically. A Task run refused before any model work ends `blocked`; one stopped after model work started ends `failed`, and the work that finished stays in its transcript. Only a person who owns the limit should raise it; see [model spending limits](recipes/usage-dashboards.md#model-spending-limits).
- `subscription_required` (402): no active paid plan. Choose one in the dashboard.
- `usage_credit_required` (402): the plan is active but its usage credit is used up. Add credit in the dashboard.
- `rate_limited` (429): too many interactive turns at once, or resources created faster than the creation rate limit. Wait for `Retry-After` when present, otherwise back off with jitter and cap your concurrency. This one is safe to retry.
- `merchant_subscription_required` and `merchant_balance_required` (402) come from your own monetization guard: your end user has no subscription or balance with your billing provider.

## Session busy

`session_busy` (409) means the Session cannot take a new turn yet. Regeneration and deletion wait too. `error.details.reason` says why, and only the first reason clears by waiting:

- `turn_running`: another turn holds the Session, or an approval continuation is running. Steer it with `sessions.submitInput()`, or hold the message until the Session is idle.
- `approval_pending`: a tool approval waits for a decision. List the Session's pending tool approvals and decide the round with `continueChat`. See [human approval](recipes/human-approval.md).
- `continuation_waiting`: the round is decided but its continuation has not run. Call `continueChat` with the same decisions.
- Some `session_busy` responses carry no reason. Treat them as `turn_running`.
- Show the error to your user, keep their draft, and let them send again once the work settles.
- `session_version_mismatch` (409) means two turns ran on the same Session at once and this one was not saved. Read the Session's messages to see what was saved, then resend if needed.
- To prevent both, steer the running turn with `sessions.submitInput()` or hold new messages in your client until the Session is idle, and send one chat turn at a time per Session.
- Deleting a Session returns `session_busy` while any turn runs, or `session_turn_unresponsive` when the last turn stopped responding.
- `session_turn_unresponsive` (409) means the Session's previous turn stopped responding, for example because the platform restarted, and still holds the Session. The Session frees within a minute. A `session_busy` can come first while the stopped turn still looks busy. New chat, regeneration, approval continuations, and deletes all return the new code.
  - Wait for the `Retry-After` header (`error.headers` in TypeScript). It holds whole seconds, at most a minute, and `error.details.retryAfterSeconds` repeats the value. Sending earlier fails the same way.
  - Read the Session's messages before you resend, because the stopped turn may have saved its work.
  - Send a chat turn again under a new message ID. Repeat an approval continuation with the same decisions, which stay recorded. Repeat a delete as it was.

## Session input errors

Session inputs are steer attempts on the running turn. Each carries your `requestId`. BA compares the original message for that ID, so a retry is safe only when it repeats the same request.

- A `requestId` must be 1 to 128 characters and not exactly `.` or `..`, because a URL would collapse those path segments. Generate IDs instead of deriving them from user text.
- `input_idempotency_conflict` (409): the `requestId` was reused with a changed message, or the message ID was already used under another `requestId`. When an acknowledgement was lost, retry with the original `requestId` and payload, or list the Session's inputs. Never mint a new `requestId` for a message whose outcome you do not know; that can deliver it twice.
- `steer_not_available` (409): the submit was refused because no turn could take a steer: the Session is idle, stopping, or waiting on a tool approval. Nothing was saved. Keep the message in your client and send it as ordinary chat once activity is `idle`.
- Read terminal receipts with `inputs({ includeCompleted: true })`. `inputs()` is receipts, not your queue. For receipt states and what to do with each, read [chat in your app](recipes/chat-in-your-app.md#how-it-works).
- `message_id_conflict` (409) on chat: the submission contains a message ID already in accepted history, so it ran nothing. The message is already saved; reload history instead of resending. Regeneration may reuse IDs.

## Invalid cursor

`invalid_cursor` (400) means the `cursor` was not returned by this list, was changed, or came from a call with different filters.

- Start again from the first page without a cursor.
- Pass `nextCursor` back exactly as received, to the same method with the same filters. Treat it as opaque.
- For Session messages, `nextCursor` goes back as `cursor` for older pages, and `latestCursor` goes back as `after` for newer messages. Mixing them up is a common cause. `after` never returns an assistant message that a tool approval decision or continuation updated in place. While a loaded message has a tool part in state `approval-requested` or `approval-responded`, poll the newest page without `after` instead.

## Tool blocked by approval policy

Each Agent has two approval policies: `approvalInChat` for chat and stateless generation, and `approvalInTasks` for Task runs. Each has a `default` mode and per-tool `overrides`: `full` runs freely, `deny` blocks, `manual` waits for a person, and `auto` lets the model decide or ask a person.

- A `deny` rule blocks the call. The agent receives a denied result and carries on without it.
- In Task runs and stateless generation, nobody can approve, so `manual` calls and `auto` calls that need a person are blocked too.
- An `auto` review that fails blocks the call.

To fix it:

- Read the Agent and check which policy applies to the surface you call. A tool can be allowed in chat and blocked in Tasks.
- Change the rule to `full` for that tool, or move work that needs a human into an interactive chat Session.
- A Session or Task run saves its approval policy. An Agent edit changes the policy for new work.

## MCP authorization missing

An MCP connection has a `status`: `connected`, `needs_auth`, or `error`. A connection using `oauth_authorization_code` starts as `needs_auth`, and returns to it after `reconnect()`. At the start of every turn, Blazing Agents loads the tools of every attached connection. A connection that needs sign-in, or a server that cannot be reached, fails the whole turn with `mcp_connection_discovery_failed` (502). Blazing Agents never runs the turn with fewer tools.

Check the connection and run a live test:

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const mcpConnectionId: string;

export async function checkMcpConnection() {
  const connection = await client.mcpConnections.get({ mcpConnectionId });
  console.log(connection.status, connection.lastAuthErrorCode);
  const test = await client.mcpConnections.test({ mcpConnectionId });
  if (!test.ok) console.log(test.error.code, test.error.message);
}
```

- `needs_auth`: a tenant administrator opens the MCP connections page in the dashboard and clicks **Connect** to sign in. An API key cannot start this sign-in, and no SDK has a method for it.
- `MCP_CONNECTION_AUTHENTICATION_FAILED`: the server rejected the token or client secret. Get a new one and call `reconnect()`.
- `MCP_CONNECTION_UNREACHABLE` or `MCP_CONNECTION_DISCOVERY_FAILED`: check that the server is up, reachable from the public internet, and implements tool listing.
- To keep the Agent working while you fix it, remove the connection from the Agent's `mcpConnectionIds`. The list you send replaces the whole list.

## Stream ended without finish

A turn is done only when its stream finishes normally with a `finish` chunk. A `200` status or a closed connection proves nothing. Once a stream has started, its status is already sent, so later failures arrive as an `error` chunk inside the stream, or the stream just stops.

A chat or approval-continuation turn that the platform cuts after it started ends in a fixed order. First comes a transient `data-ba-error` part with `data.code` set to `turn_interrupted`. Then come an `error` chunk and `[DONE]`. The HTTP status stays 200.

- `turn_interrupted` is a stream code only. No HTTP error returns it, and the `error` chunk carries no code.
- The turn may have saved its work before the cut. Read the Session's messages before you resend.
- The Session can stay busy for up to a minute. A resend in that time returns `session_busy`, then `session_turn_unresponsive`. See [session busy](#session-busy).

- In a `useChat` frontend, `onFinish` receives `isAbort`, `isError`, `isDisconnect`, and `finishReason`. Treat the turn as failed when any flag is set, `finishReason` is missing, or it equals `"error"`. Restore the last good messages and keep the user's draft.
- Completion and object streams carry no `data-ba-error` part. A cut one fails the stream. In TypeScript, awaiting `result.text` or `result.object` rejects with `stream_error`. A network failure before any response is `network_error`, and your own abort is `request_aborted`. In Python, these are `StreamError` and `APIConnectionError`; in Rust, `Error::Stream` and `Error::Connection`; in Go, `*ba.StreamError` and `*ba.ConnectionError`.
- A failed or cancelled turn adds nothing to Session history, but a dropped connection can hide a turn that finished and was saved. Reload the Session's messages before you assume the reply was lost.
- A resend is an ordinary new message with a fresh message ID. It can repeat tool side effects.
- Log `requestId` from the result. Relay responses built by the SDK keep the original request ID.

## Chat Connection health unknown

A Chat Connection's `health` holds the last check: `tokenValid`, `identityVerified`, and a list of `checks`, each with a `code`, a `status` of `pass`, `fail`, or `unknown`, and an optional `subject`. `unknown` means the check could not tell, not that it passed. Run a fresh check:

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const chatConnectionId: string;

export async function checkChatHealth() {
  const { enabled, health } = await client.chatConnections.checkHealth({ chatConnectionId });
  console.log({ enabled, tokenValid: health.tokenValid });
  for (const check of health.checks) {
    if (check.status !== "pass") console.log(check.code, check.status, check.subject);
  }
}
```

For every check that is `fail` or `unknown`, verify that setting by hand on the platform:

- `webhook_url` (Telegram): the bot's webhook points at the connection's `webhookUrl`. A valid token alone does not prove messages arrive. Enable the connection again to re-register it. `chat_webhook_conflict` (409) means the bot already has a webhook set by another service. Remove it, or use a new bot.
- `channel_membership`: the bot is in the listed channel or chat. `channelIds` and `chatIds` choose where checks look; they do not restrict where the bot answers.
- `bot_identity`: the bot identity read from the token matches the connection. On failure, check that the token is current and for the same bot. Rotate with the full credential set for Slack, or only the new bot token for Telegram.
- Also confirm that both the connection and its Agent are enabled, your subscription is active, and, for Slack, that both the Event Subscriptions and Interactivity request URLs point at `webhookUrl`.
- If the agent finished but no reply appeared, read the Session's messages (`sessions.messages()` in TypeScript and Python, `sessions().messages()` in Rust, `client.Sessions.ListMessages()` in Go). A reply that is in the transcript but not in the chat failed to post after its retries, and BA does not send it again. Run the connection's health check and fix what it reports before the next message.

See [Slack and Telegram](recipes/slack-and-telegram.md) for setup.

## Go deeper

- [Errors](https://docs.blazingagents.com/api-reference/protocols/errors)
- [Limits and reliability](https://docs.blazingagents.com/platform/limits-and-reliability)
- [Streaming protocol](https://docs.blazingagents.com/api-reference/protocols/streaming)
- [Sessions and turns](https://docs.blazingagents.com/platform/sessions-and-turns)
- [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals)
- [MCP tools](https://docs.blazingagents.com/agents/tools/mcp-tools)
- [Providers and models](https://docs.blazingagents.com/agents/providers-and-models)
- [Usage and quotas](https://docs.blazingagents.com/platform/usage-and-quotas)
- [Slack and Telegram](https://docs.blazingagents.com/platform/chat-integrations)
- [Build a chatbot](https://docs.blazingagents.com/getting-started/chatbot)
