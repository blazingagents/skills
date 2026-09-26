# Put your Agent in Slack or Telegram

By the end, people message your own Slack app or Telegram bot and your existing Agent replies, with history per conversation and tool approval buttons in the chat.

## When to use this

You already have an Agent with a Provider and model, an active Blazing Agents plan, and you want it reachable from Slack or Telegram without running a bot server. BA receives the platform's messages, keeps a Session per conversation, posts replies, and renders approval cards.
If you instead want chat inside your own web or mobile app, read [Add chat to your app](chat-in-your-app.md).

## How it works

A Chat Connection links one bot to one Agent. You create it from your backend with the bot's credentials, and BA returns a `webhookUrl` that the platform must send events to. For Slack you paste that URL into your Slack app. For Telegram, BA registers it with Telegram when you enable the connection. Each direct message, shared thread, and Telegram forum topic gets its own Session. The connection's Agent and bot are fixed; to change either, create a new connection.

## Build it

1. Create the connection with intake disabled, so no message arrives before setup is done. Save the returned `id` and `webhookUrl` in your config; neither is secret.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
const botToken = process.env.SLACK_BOT_TOKEN;
const signingSecret = process.env.SLACK_SIGNING_SECRET;
if (!apiKey || !botToken || !signingSecret) {
  throw new Error("Set BLAZING_AGENTS_API_KEY, SLACK_BOT_TOKEN, and SLACK_SIGNING_SECRET");
}

const client = new BlazingAgents({ apiKey });

const connection = await client.chatConnections.create({
  name: "Support on Slack",
  agentId: "ag_0123456789abcdef",
  platform: "slack",
  enabled: false,
  credentials: { botToken, signingSecret },
  configuration: { channelIds: ["C0123456789"] },
});
console.log(connection.id, connection.webhookUrl);
```

```python
import os

from blazing_agents import BlazingAgents

client = BlazingAgents()

connection = client.chat_connections.create(
    name="Support on Slack",
    agent_id="ag_0123456789abcdef",
    platform="slack",
    enabled=False,
    credentials={
        "bot_token": os.environ["SLACK_BOT_TOKEN"],
        "signing_secret": os.environ["SLACK_SIGNING_SECRET"],
    },
    configuration={"channel_ids": ["C0123456789"]},
)
print(connection.id, connection.webhook_url)
```

For Telegram, pass `platform: "telegram"`, `credentials: { botToken }`, and optionally `configuration: { chatIds, businessMode }`. Set `businessMode: true` only for a Telegram Business bot.

2. Register the URL on the platform. This is a separate step from creating the connection.

```text
Slack:
  - Bot scopes: app_mentions:read, chat:write, channels:history, groups:history,
    im:history, mpim:history, users:read, channels:read, groups:read, im:read,
    mpim:read. Reinstall the app after changing scopes.
  - Set BOTH Event Subscriptions and Interactivity Request URL to webhookUrl.
    Slack's URL check passes while the connection is disabled.
  - Subscribe to app_mention, message.channels, message.groups, message.im, message.mpim.
  - Invite the bot to each channel it should serve.
Telegram:
  - Nothing to paste. BA registers webhookUrl when you enable the connection.
  - Turn off privacy mode in BotFather to answer group messages without a mention.
```

3. Check health, enable, then check again. A valid token does not prove messages arrive, so require the `webhook_url` check to pass after enabling.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const chatConnectionId: string;

const before = await client.chatConnections.checkHealth({ chatConnectionId });
if (!before.health.tokenValid || !before.health.identityVerified) {
  throw new Error("Bot credentials rejected; fix them before enabling");
}

await client.chatConnections.enable({ chatConnectionId });

const { health } = await client.chatConnections.checkHealth({ chatConnectionId });
const webhook = health.checks.find(({ code }) => code === "webhook_url");
if (webhook?.status !== "pass") console.warn("Webhook not confirmed", health.checks);
```

```python
from blazing_agents import BlazingAgents


def go_live(client: BlazingAgents, chat_connection_id: str) -> None:
    before = client.chat_connections.check_health(chat_connection_id)
    if not (before.health.token_valid and before.health.identity_verified):
        raise RuntimeError("Bot credentials rejected; fix them before enabling")

    client.chat_connections.enable(chat_connection_id)

    health = client.chat_connections.check_health(chat_connection_id).health
    webhook = next((c for c in health.checks if c.code == "webhook_url"), None)
    if webhook is None or webhook.status != "pass":
        print("Webhook not confirmed", health.checks)
```

4. Rotate credentials by sending the complete set for the same bot or Slack installation. Sessions stay attached.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const chatConnectionId: string;
declare const newBotToken: string;

const rotated = await client.chatConnections.rotateCredentials({
  chatConnectionId,
  platform: "telegram",
  botToken: newBotToken,
});
console.log(rotated.credentialVersion, rotated.credentialFragment);
```

```python
from blazing_agents import BlazingAgents


def rotate(client: BlazingAgents, chat_connection_id: str, new_bot_token: str) -> None:
    rotated = client.chat_connections.rotate_credentials(
        chat_connection_id,
        platform="telegram",
        credentials={"bot_token": new_bot_token},
    )
    print(rotated.credential_version, rotated.credential_fragment)
```

5. Pause or remove the connection. `disable()` stops new messages and approval clicks; work already running may finish, and missed messages are not replayed on `enable()`. `delete()` disconnects the bot and keeps its Sessions readable. BA clears the Telegram webhook it set; uninstall a Slack app yourself.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const chatConnectionId: string;

await client.chatConnections.disable({ chatConnectionId });
await client.chatConnections.delete({ chatConnectionId });
```

```python
from blazing_agents import BlazingAgents


def remove(client: BlazingAgents, chat_connection_id: str) -> None:
    client.chat_connections.disable(chat_connection_id)
    client.chat_connections.delete(chat_connection_id)
```

## Gotchas

- Anyone who can reach the bot can talk to it, and anyone who can see an approval card can approve or deny it. Choose where you add the bot and which Tools need approval (`approvalInChat` on the Agent) with that in mind.
- `channelIds` and `chatIds` only tell health checks where to look. They are not allowlists.
- If `create()` times out, `list()` connections before retrying so you do not create two.
- Enabling a Telegram bot that already points at another webhook fails with `chat_webhook_conflict` (409). Remove the old webhook, then enable again.
- `update()` changes only `name` and `configuration`. Create a new connection to switch the Agent or bot.
- Keep bot tokens and signing secrets in backend environment variables. Responses never return them; log only `id`, `enabled`, `credentialFragment`, and health results.
- A health check `status` of `unknown` means BA could not tell. Verify that platform setting by hand.
- The bot stays silent. Confirm the connection and its Agent are both enabled, your plan is active, and the bot is in the channel, then run a fresh health check. See [Troubleshooting](../troubleshooting.md#chat-connection-health-unknown).
- Messages sent while the Agent is still replying in the same conversation may be dropped.
- `/reset` in a chat starts fresh only after you deleted that conversation's Session. It does not replace a Session that still exists.

## Check it works

- `get()` shows `enabled: true` and the `webhook_url` health check is `pass`.
- Slack: mention the bot in a channel thread, send a follow-up in the thread, and send a direct message. Each gets a reply, and the follow-up remembers the first message.
- Telegram: message the bot directly, then send a follow-up. The second reply remembers the first.
- If the Agent has a Tool that requires approval, trigger it and click the card. The Turn continues.
- After `disable()`, a new message gets no reply. After `enable()`, the next message does.

## Go deeper

- [Slack and Telegram](https://docs.blazingagents.com/platform/chat-integrations)
- [TypeScript chat connections](https://docs.blazingagents.com/sdk/typescript/chat-integrations) and [Python chat connections](https://docs.blazingagents.com/sdk/python/chat-integrations)
- [Chat connections REST API](https://docs.blazingagents.com/api-reference/rest-api/chat-connections), including listing and repairing deliveries when a finished reply never appeared
- [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals)
