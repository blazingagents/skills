# Slack and Telegram connections

Use BA's managed Chat Connections when the user wants an existing Agent in Slack
or Telegram. BA keeps the Sessions, posts replies, and renders approval cards.
Use `client.chatConnections` for connection configuration.

Read [setup](https://docs.blazingagents.com/platform/chat-integrations) before
creating a connection, including registering the returned `webhookUrl` on the
platform. Read the
[TypeScript SDK reference](https://docs.blazingagents.com/sdk/typescript/chat-integrations)
for exact arguments. Keep bot credentials in environment variables;
report only IDs, enabled state, and safe health results.

The resource provides list, get, create, update, credential rotation, health checks,
enable, disable, and delete. Update accepts only `name` and `configuration`;
BA generates `webhookUrl`. Changing the Agent or bot requires a new connection.
`client.chatDeliveries` is an attention feed: failed and ambiguous replies and
approval cards across every connection.

- Create: resolve the Agent, which must be one of the Tenant's own Agents and
  never the Admin Agent (`create` fails with `admin_agent_managed`, 409),
  verify the intended bot/installation, create once
  with `enabled: false`, and read `webhookUrl` from the response. For Slack,
  register that URL as both the Event Subscriptions and Interactivity Request
  URL; for Telegram, enabling registers it. Run health, enable, and test a real
  reply. Platform registration is separate from BA connection creation.
- Inspect: list/get connections, then run health if fresh evidence is needed.
  `unknown` requires manual verification; token validity does not prove delivery.
- Inspect deliveries: read-only. List the tenant-wide feed, which returns
  only failed and ambiguous deliveries, optionally bounded by `since`;
  report IDs, connection, status, and diagnostic. Do not repair.
- Rotate: replace the complete credentials for the same installation. Preserve
  Sessions.
- Disable/delete: explain that disable stops new intake while admitted work may
  finish; delete preserves Sessions and leaves platform registration unchanged.

Sender/approver policy is unrestricted. Destination IDs are health probes, not
allowlists. Any participant with access to a bound approval card can decide.
Users send `/new` to start a new conversation on purpose, even while the
current one is answering. They send `/new` in a Telegram private chat,
`/new@BotName` in a Telegram group, or `@bot /new` in a Slack channel, because
Slack never delivers a bare `/new` to the bot. The old Session stays in history,
and the next message begins on a fresh Session without waiting for the old one.
`/new` followed by other text, and other slash commands such as Telegram's
`/start`, reach the Agent as ordinary messages. After a Session is deleted, the
next message that addresses the bot starts a new conversation without `/new`. A
message that was still queued for the deleted Session is not run; the bot says
the conversation was deleted and asks the user to send the message again.

Relay these runtime behaviors when a user asks why a bot answered as it did:

- A message sent while the Agent is answering waits and is answered in order in
  the same conversation. Nothing is dropped, and other conversations, including
  other Telegram forum topics, do not wait. A redelivered platform event is
  answered once.
- If a Turn fails or stops before BA saves its reply, the bot posts that the
  reply was interrupted and asks the user to send the message again. BA does
  not run the Turn again, because Tools may already have run. An interrupted
  approval round asks the user to ask again.
- A message sent while a Tool approval waits is not run. The bot asks the user
  to approve or reject the request first, then send the message again, or to
  send `/new` if the request is lost.
- BA sends a saved reply that it had not yet sent when it was interrupted, with
  no repair needed. Only failed and ambiguous deliveries need attention.
- A message with no text is ignored. In a channel, a message that does not
  mention the bot is answered only in a thread the bot already joined.
- In a Telegram private chat the reply appears as a growing draft, then as the
  final message. Slack and group chats show the final message only.
