# Troubleshoot a Blazing Agents integration

Find the symptom, read the likely cause, and apply the fix. Every failed request carries a stable error `code` and an HTTP status; branch on the code, never on the message text.

## Read the error first

Every SDK failure is a `BlazingAgentsError` in TypeScript. In Python, an error response raises `APIStatusError`, a network failure raises `APIConnectionError` (or its subclass `APITimeoutError`), and a failure after a stream starts raises `StreamError`. Log the code, status, and request ID before you decide anything.

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

```python
from blazing_agents import Agent, APIStatusError, BlazingAgents


def read_agent(client: BlazingAgents, agent_id: str) -> Agent:
    try:
        return client.agents.get(agent_id)
    except APIStatusError as error:
        print(
            {
                "code": error.code,
                "status": error.status_code,
                "request_id": error.request_id,
                "agent_id": agent_id,
            }
        )
        raise
```

Use `BlazingAgentsError.isInstance(error)` instead of `instanceof`, which fails when two copies of the package are installed. Treat `error.code` as an open string: new codes can appear. The TypeScript SDK adds four codes of its own: `network_error`, `request_aborted`, `stream_error`, and `invalid_response`.

## Symptom table

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `unauthorized` (401) | Missing, mistyped, revoked, or expired API key, or a dashboard-only call made with an API key. | [Replace the key](#401-unauthorized). |
| 403 on chat or generation | `merchant_customer_unmapped`: your monetization guard found no customer for the turn's `userId`. | [Link the user](#403-on-a-turn). |
| `not_found` (404) for an ID you just created | The key is for a different Tenant, or the ID is wrong. | [Check the key's Tenant](#404-for-a-resource-you-can-see-in-the-dashboard). |
| `provider_required` (400) | The Agent, or the Agent Version the turn pins, has no Provider and model. | [Set a Provider and model](#agent-without-a-provider-or-model). |
| `model_not_found` (400) or `model_validation_unavailable` (503) | The model ID is not in the Provider's list, or the Provider could not be reached or rejected the stored key. | [Fix the model or the Provider](#provider-credential-rejected). |
| Turn fails right after it starts, no code | The Provider rejected the stored key or the request during the turn. | [Replace the Provider](#provider-credential-rejected). |
| `quota_exceeded` (429), or a Task run ends `blocked` | Usage in the current window is at or above your tenant quota. | [Wait for reset or raise the quota](#quota-blocked). |
| `subscription_required` or `usage_credit_required` (402) | No active plan, or no usage credit left. | [Fix billing](#quota-blocked). |
| `rate_limited` (429) | Too many interactive turns at once, or resources created too fast. | [Back off](#quota-blocked). |
| `session_busy` (409) | A tool approval is pending, an approved call is running, or another turn holds the Session. | [Decide approvals, then resend](#session-busy). |
| `session_version_mismatch` (409) | Two turns ran on the same Session at once; this one was not saved. | [Send one turn at a time](#session-busy). |
| `invalid_cursor` (400) | The cursor was altered, came from another list, or was reused with different filters. | [Restart pagination](#invalid-cursor). |
| Tool call never runs; the agent reports it was denied | The approval policy for this surface is `deny`, or `manual`/`auto` in a Task or stateless generation, where no person can approve. | [Change the policy or use chat](#tool-blocked-by-approval-policy). |
| Turn fails with `mcp_connection_discovery_failed` (502), or the connection shows `needs_auth` | An attached MCP connection needs OAuth sign-in, or its server is down. | [Finish sign-in or detach](#mcp-authorization-missing). |
| Chat stream ends without a `finish` chunk, or `stream_error` | The stream broke after it started: network drop, server error, or your Stop. | [Reload history and let the user resend](#stream-ended-without-finish). |
| Slack or Telegram bot stays silent; a health check shows `unknown` | The health check could not verify a setting. | [Check that setting by hand](#chat-connection-health-unknown). |

For any code not listed here, open its entry in the [error catalog](https://docs.blazingagents.com/api-reference/protocols/errors). Each entry says whether retrying the same request can succeed.

## 401 unauthorized

The `Authorization` header is missing, or the key in it is revoked, expired, or mistyped.

- Check that your backend reads `BLAZING_AGENTS_API_KEY` from the environment you expect, and that the full `ba_...` value was copied.
- Create a new key in the dashboard at `https://www.blazingagents.com/app/keys`, deploy it, then revoke the old one. Blazing Agents cannot show an existing key again.
- Dashboard-only operations, such as creating API keys, starting checkout, or `mcpConnections.connect()`, also return `unauthorized` with an API key. Do those in the dashboard.
- Retrying unchanged fails the same way.

## 403 on a turn

Blazing Agents has no separate "forbidden" code for API keys. A bad key is always `unauthorized` (401). The only 403 is `merchant_customer_unmapped`, returned when your monetization guard is on and the turn's `userId` has no linked billing customer. Task runs in the same situation end as `blocked`.

- Link the `userId` to a customer in your billing provider, then start the turn again.
- If you did not intend to bill per user, turn off the guard.

## 404 for a resource you can see in the dashboard

`not_found` means the resource does not exist in the Tenant your key is for. Blazing Agents gives the same answer for a wrong ID, a deleted resource, and another Tenant's resource.

- Check the ID's prefix, such as `ag_` or `ss_`.
- Check that the key is for the same Tenant as the dashboard you are looking at.
- Resuming a Session through a different Agent also returns `not_found`. Each Session is tied to one Agent.

## Agent without a Provider or model

`provider_required` (400) means the Agent Version that would run has no Provider and model. Nothing ran and nothing was billed.

- Update the Agent with a `providerId` and a `model` the Provider offers. Changing `providerId` without `model` in the same update is rejected; changing only `model` keeps the current Provider.
- If the Session or Task pins an older Version, that Version may have no model. Pin a Version that has one. A Session's pin cannot change, so start a new Session.
- `agent_version_not_found` (404) means the pin names a Version number that never existed.
- `agent_disabled` (409) means the Agent is disabled. Enable it.

## Provider credential rejected

A Provider's key, type, and base URL are fixed after creation. When the key stops working, you replace the Provider.

- **When you save an Agent or list models:** `model_validation_unavailable` (503) means Blazing Agents could not get a usable model list. The Provider may be down, or it rejected the stored key. Retry once after a short wait; if it persists, the key is the likely cause.
- **When you save an Agent:** `model_not_found` (400) means the model ID is not in the Provider's current list. Check the spelling and prefix, such as `openai/`.
- **During a turn:** a rejection surfaces as an `error` chunk in the chat stream, as `stream_error` when you await a completion, or as a Task run that ends `failed` with text in its `error` field. There is no dedicated error code.

To fix it:

1. Create a new Provider with a working key.
2. Update each Agent with the new `providerId` and `model` together.
3. Delete the old Provider. `provider_in_use` (409) lists Agents still on it in `details.agentIds`. `provider_historical_use` (409) lists pinned Versions, Sessions, and Tasks in `details.agentVersions`, `details.sessionIds`, and `details.taskIds`. Move those first, or delete with `confirmVersionInvalidation: true` (`confirm_version_invalidation=True` in Python) and accept that those Versions then fail with `provider_not_found`.

## Quota blocked

- `quota_exceeded` (429): usage in the current window reached the tenant quota you set, so the turn did not start. A Task run in the same situation ends as `blocked`, not `failed`. Wait for the reset day, or raise or remove the quota with `client.tenant.patch()` (`client.tenant.update()` in Python). Retrying before the reset fails the same way.
- `subscription_required` (402): no active paid plan. Choose one in the dashboard.
- `usage_credit_required` (402): the plan is active but its usage credit is used up. Add credit in the dashboard.
- `rate_limited` (429): too many interactive turns at once, or resources created faster than the creation rate limit. Wait for `Retry-After` when present, otherwise back off with jitter and cap your concurrency. This one is safe to retry.
- `merchant_subscription_required` and `merchant_balance_required` (402) come from your own monetization guard: your end user has no subscription or balance with your billing provider.

## Session busy

`session_busy` (409) means the Session cannot take a new turn yet. A tool approval is waiting for a decision, an approved tool call is still running, or another turn holds the Session. Regeneration and deletion wait too.

- List the Session's pending tool approvals and decide them. See [human approval](recipes/human-approval.md).
- Show the error to your user, keep their draft, and let them send again once the work settles.
- `session_version_mismatch` (409) means two turns ran on the same Session at once and this one was not saved. Read the Session's messages to see what was saved, then resend if needed.
- Prevent both in your frontend: disable Send while a turn is streaming, and send one turn at a time per Session.

## Invalid cursor

`invalid_cursor` (400) means the `cursor` was not returned by this list, was changed, or came from a call with different filters.

- Start again from the first page without a cursor.
- Pass `nextCursor` back exactly as received, to the same method with the same filters. Treat it as opaque.
- For Session messages, `nextCursor` goes back as `cursor` for older pages, and `latestCursor` goes back as `after` for newer messages. Mixing them up is a common cause.

## Tool blocked by approval policy

Each Agent has two approval policies: `approvalInChat` for chat and stateless generation, and `approvalInTasks` for Task runs. Each has a `default` mode and per-tool `overrides`: `full` runs freely, `deny` blocks, `manual` waits for a person, and `auto` lets the model decide or ask a person.

- A `deny` rule blocks the call. The agent receives a denied result and carries on without it.
- In Task runs and stateless generation, nobody can approve, so `manual` calls and `auto` calls that need a person are blocked too.
- An `auto` review that fails blocks the call.

To fix it:

- Read the Agent and check which policy applies to the surface you call. A tool can be allowed in chat and blocked in Tasks.
- Change the rule to `full` for that tool, or move work that needs a human into an interactive chat Session.
- Policies are part of the Agent Version. A pinned Session or Task keeps the old policy.

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

```python
from blazing_agents import BlazingAgents


def check_mcp_connection(client: BlazingAgents, mcp_connection_id: str) -> None:
    connection = client.mcp_connections.get(mcp_connection_id)
    print(connection.status, connection.last_auth_error_code)
    test = client.mcp_connections.test(mcp_connection_id)
    if test.error is not None:
        print(test.error.code, test.error.message)
```

- `needs_auth`: a tenant administrator opens the MCP connections page in the dashboard and clicks **Connect** to sign in. An API key cannot start this sign-in; `connect()` with an API key returns `unauthorized`.
- `MCP_CONNECTION_AUTHENTICATION_FAILED`: the server rejected the token or client secret. Get a new one and call `reconnect()`.
- `MCP_CONNECTION_UNREACHABLE` or `MCP_CONNECTION_DISCOVERY_FAILED`: check that the server is up, reachable from the public internet, and implements tool listing.
- To keep the Agent working while you fix it, remove the connection from the Agent's `mcpConnectionIds`. The list you send replaces the whole list.

## Stream ended without finish

A turn is done only when its stream finishes normally with a `finish` chunk. A `200` status or a closed connection proves nothing. Once a stream has started, its status is already sent, so later failures arrive as an `error` chunk inside the stream, or the stream just stops.

- In a `useChat` frontend, `onFinish` receives `isAbort`, `isError`, `isDisconnect`, and `finishReason`. Treat the turn as failed when any flag is set, `finishReason` is missing, or it equals `"error"`. Restore the last good messages and keep the user's draft.
- In TypeScript, awaiting `result.text` or `result.object` rejects with `stream_error`. A network failure before any response is `network_error`, and your own abort is `request_aborted`. In Python, these are `StreamError` and `APIConnectionError`.
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

```python
from blazing_agents import BlazingAgents


def check_chat_health(client: BlazingAgents, chat_connection_id: str) -> None:
    connection = client.chat_connections.check_health(chat_connection_id)
    print(connection.enabled, connection.health.token_valid)
    for check in connection.health.checks:
        if check.status != "pass":
            print(check.code, check.status, check.subject)
```

For every check that is `fail` or `unknown`, verify that setting by hand on the platform:

- `webhook_url` (Telegram): the bot's webhook points at the connection's `webhookUrl`. A valid token alone does not prove messages arrive. Enable the connection again to re-register it. `chat_webhook_conflict` (409) means the bot already has a webhook set by another service. Remove it, or use a new bot.
- `channel_membership`: the bot is in the listed channel or chat. `channelIds` and `chatIds` choose where checks look; they do not restrict where the bot answers.
- `bot_identity`: the bot identity read from the token matches the connection. On failure, check that the token is current and for the same bot. Rotate with the full credential set for Slack, or only the new bot token for Telegram.
- Also confirm that both the connection and its Agent are enabled, your subscription is active, and, for Slack, that both the Event Subscriptions and Interactivity request URLs point at `webhookUrl`.
- If the agent finished but no reply appeared, list the connection's deliveries. `confirmed` means the platform accepted the reply, `failed` means it did not, and `ambiguous` means it may have been sent. Repairing a delivery posts the saved reply without running the agent again, and it can post a duplicate.

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
