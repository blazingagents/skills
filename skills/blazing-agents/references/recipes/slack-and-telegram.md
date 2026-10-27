# Put your Agent in Slack or Telegram

By the end, people message your own Slack app or Telegram bot and your existing Agent replies, with history per conversation and tool approval buttons in the chat.

## When to use this

You already have one of your own Agents with a Provider and model, an active Blazing Agents plan, and you want it reachable from Slack or Telegram without running a bot server. The Admin Agent cannot be connected. BA receives the platform's messages, keeps a Session per conversation, posts replies, and renders approval cards.
If you instead want chat inside your own web or mobile app, read [Add chat to your app](chat-in-your-app.md).

## How it works

A Chat Connection links one bot to one Agent. You create it from your backend with the bot's credentials, and BA returns a `webhookUrl` that the platform must send events to. For Slack you paste that URL into your Slack app. For Telegram, BA registers it with Telegram when you enable the connection. Each direct message, shared thread, and Telegram forum topic gets its own Session. The connection's Agent and bot are fixed; to change either, create a new connection.

A message sent while the Agent is answering is steered into that answer, and one reply covers both (see Gotchas for the exceptions). Different conversations, including different Telegram forum topics, do not wait for each other. If the platform redelivers an event, the Agent answers once. In a Telegram private chat the reply appears as a draft that grows while the Agent works, then as the final message. Slack and group chats show only the final message.

## Build it

For a Python, Rust, or Go backend, read the code for these steps in [Python](slack-and-telegram.python.md), [Rust](slack-and-telegram.rust.md), [Go](slack-and-telegram.go.md).

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

For Telegram, pass `platform: "telegram"`, `credentials: { botToken }`, and optionally `configuration: { chatIds, businessMode }`. Set `businessMode: true` only for a Telegram Business bot.

2. Register the URL on the platform. This is a separate step from creating the connection.

```text
Slack:
  - Bot scopes: chat:write, channels:history, groups:history, im:history,
    mpim:history, users:read, channels:read, groups:read, im:read, mpim:read.
    Reinstall the app after changing scopes.
  - Set BOTH Event Subscriptions and Interactivity Request URL to webhookUrl.
    Slack's URL check passes while the connection is disabled.
  - Subscribe to message.channels, message.groups, message.im, message.mpim.
    A mention arrives as a message event; app_mention is not needed and is ignored.
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

5. Pause or remove the connection. `disable()` stops new messages and approval clicks; work already running may finish, and missed messages are not replayed on `enable()`. `delete()` disconnects the bot and keeps its Sessions readable. BA clears the Telegram webhook it set; uninstall a Slack app yourself.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const chatConnectionId: string;

await client.chatConnections.disable({ chatConnectionId });
await client.chatConnections.delete({ chatConnectionId });
```

## Gotchas

- Anyone who can reach the bot can talk to it, and anyone who can see an approval card can approve or deny it. Choose where you add the bot and which Tools need approval (`approvalInChat` on the Agent) with that in mind.
- Bot Turns run with full authority and no End-user scope, so give the Agent only Tools that are safe for every participant. Each conversation's Session `userId` is a JSON array naming the platform, the connection, and the person in a direct message, but the thread in a shared conversation. Per-user usage, billing, and MCP `userId` forwarding therefore see one user per thread. All conversations share the Agent's Workspace files.
- Disabling the connection or rotating its credentials does not stop a running Turn: it finishes and keeps its reply in the Session, but the bot posts neither the reply nor its approval cards, and messages waiting behind it in that conversation are dropped without a notice. Do both when conversations are quiet.
- `channelIds` and `chatIds` only tell health checks where to look. They are not allowlists.
- If `create()` times out, `list()` connections before retrying so you do not create two.
- Enabling a Telegram bot that already points at another webhook fails with `chat_webhook_conflict` (409). Remove the old webhook, then enable again.
- `update()` changes only `name` and `configuration`. Create a new connection to switch the Agent or bot.
- Keep bot tokens and signing secrets in backend environment variables. Responses never return them; log only `id`, `enabled`, `credentialFragment`, and health results.
- A health check `status` of `unknown` means BA could not tell. Verify that platform setting by hand.
- The bot stays silent. Confirm the connection and its Agent are both enabled, your plan is active, and the bot is in the channel, then run a fresh health check. See [Troubleshooting](../troubleshooting.md#chat-connection-health-unknown).
- `create()` for the Admin Agent fails with `admin_agent_managed` (409), and the dashboard leaves the Admin Agent out of the bot form. Connect one of your own Agents.
- If BA refuses a Turn before it starts, nothing runs and the bot tells the user why in plain words chosen by the Turn's error code: for example `agent_disabled`, `provider_required`, `subscription_required`, `usage_credit_required`, `model_spending_limit_exceeded`, `rate_limited`, or the end user's `merchant_subscription_required` and `merchant_balance_required`. Account and setup reasons ask the user to contact your team, so fix the cause rather than telling users to resend. A refused approval round is cancelled.
- If a Turn fails or stops after it starts and before BA saves its reply, for example after a model error or an interruption inside BA such as a deploy, the bot posts "Your message was received, but the reply was interrupted before it was saved. Please send it again." BA does not run the Turn again, because Tools may already have run. An interrupted approval round says the action was interrupted and asks the user to ask again.
- A message sent while the Agent is still answering is steered into that Turn, as `sessions.submitInput()` steers through the API. The Agent reads it at its next step, and one reply covers both messages, so the user never resends. A message the Turn cannot take, for example because it is ending or stopping, waits and runs as the next Turn. Only if something else keeps the conversation busy for longer than the Turn cap, such as back-to-back Turns your backend started through the API on that Session, does the bot say "This conversation stayed busy with other work, so your message was not processed. Please send it again." Telegram shows the bot typing while the Agent works.
- Messages from bots are ignored, your own bot's included, even when they mention your bot. Another bot cannot start or continue a conversation. Telegram shows anonymous group admins and members posting as a channel as bot accounts, so their messages are ignored too.
- Replies are posted exactly as the Agent writes them. In Slack, a mention such as `<!channel>`, a link, or formatting in a reply takes effect, so instruct the Agent how to format replies and remember that content it reads can steer what it writes. Approval cards show Tool input as plain text.
- A message sent while a Tool approval waits for its decision is not run or steered, as the API refuses to steer a Turn that waits for a decision. The bot says the request must be approved or rejected first, and the user sends the message again after deciding, or sends `/new` if the request is lost.
- A message with no text, such as a photo without a caption, is ignored. In a channel, a message that does not mention the bot is answered only in a thread the bot is already part of.
- `/new` in a chat starts a new conversation at once, even while the current one is answering. Send `/new` in a Telegram private chat, `/new@BotName` in a Telegram group, or `@bot /new` in a Slack channel, because Slack never delivers a bare `/new` to the bot. The old Session stays in history. After you delete a conversation's Session, the next message that addresses the bot starts a new conversation without `/new`. Any other slash command, such as Telegram's `/start`, reaches the Agent as an ordinary message.

## Check it works

- `get()` shows `enabled: true` and the `webhook_url` health check is `pass`.
- Slack: mention the bot in a channel thread, send a follow-up in the thread, and send a direct message. Each gets a reply, and the follow-up remembers the first message.
- Telegram: message the bot directly, then send a follow-up. The second reply remembers the first.
- If the Agent has a Tool that requires approval, trigger it and click the card. The Turn continues.
- After `disable()`, a new message gets no reply. After `enable()`, the next message does.

## What to expect from delivery

- BA posts each reply and approval card at least once, with a few retries. A reply can rarely appear twice.
- A reply that still fails to post stays in the Session transcript, and nothing sends it again. Read the Session's messages to see it.
- An approval card that failed to post is posted again when the person sends their next message, with a note asking them to decide it first.
- A Turn you start through the API on a chat Session does not post to Slack or Telegram.

## Go deeper

- [Slack and Telegram](https://docs.blazingagents.com/platform/chat-integrations)
- [TypeScript chat connections](https://docs.blazingagents.com/sdk/typescript/chat-integrations) and [Python chat connections](https://docs.blazingagents.com/sdk/python/chat-integrations)
- [Chat connections REST API](https://docs.blazingagents.com/api-reference/rest-api/chat-connections)
- [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals)
