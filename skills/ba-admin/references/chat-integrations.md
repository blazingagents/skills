# Slack and Telegram connections

Use BA's managed Chat Connections when the user wants an existing Agent in Slack
or Telegram. BA keeps the Sessions, posts replies, and renders approval cards.
Manage connections with `client.chatConnections` in an SDK script.

Read [setup](https://docs.blazingagents.com/platform/chat-integrations) before
creating a connection, including registering the returned `webhookUrl` on the
platform. Read the
[TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/chat-integrations)
for exact arguments. Read bot credentials from environment variables; report
only IDs, enabled state, and safe health results.

The resource offers list, get, create, update, credential rotation, health
checks, enable, disable, and delete. Update accepts only `name` and
`configuration`; BA generates `webhookUrl`. Changing the Agent or the bot needs
a new connection.

- Create: resolve the Agent, which must be one of the Tenant's own Agents and
  never the Admin Agent (`admin_agent_managed`, 409). Verify the intended bot
  or installation, create once with `enabled: false`, and read `webhookUrl`
  from the response. For Slack, register that URL as both the Event
  Subscriptions and the Interactivity Request URL; for Telegram, enabling
  registers it. Run health, enable, and test a real reply.
- Inspect: list or get connections, then run health when you need fresh
  evidence. `unknown` needs manual checking; a valid token does not prove
  delivery.
- Rotate: send the complete credentials for the same installation. Sessions
  stay attached.
- Disable: stops new messages and approval clicks. Enabling again does not
  replay missed messages.
- Delete: disconnects the bot and keeps its Sessions. BA removes the Telegram
  webhook it set; the user uninstalls the Slack app.

Tell the user before a disable or a rotation that a Turn already running
finishes and keeps its reply in the Session, but the bot posts neither the reply
nor its approval cards. Messages waiting behind it in that conversation are
dropped with no notice. Suggest doing either when conversations are quiet.

Facts that shape how the user sets up a bot:

- Anyone who can reach the bot can talk to it, and anyone who sees an approval
  card can decide it. `channelIds` and `chatIds` only choose where health
  checks look; they are not allowlists.
- Every conversation runs on the connected Agent, so all of them share its
  Workspace files.
- A message sent while the Agent is answering is steered into that answer, and
  one reply covers both. While a Tool approval waits, new messages are refused
  with a notice.
- Users send `/new` (`/new@BotName` in a Telegram group, `@bot /new` in Slack)
  to start a new conversation.

When the user asks why a bot answered as it did, read
[message order and interruptions](https://docs.blazingagents.com/platform/chat-integrations#message-order).
