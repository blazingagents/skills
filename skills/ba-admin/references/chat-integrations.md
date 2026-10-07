# Slack and Telegram connections

Use BA's managed Chat Connections when the user wants an existing Agent in Slack
or Telegram. BA keeps the Sessions, posts replies, and renders approval cards.
Use TypeScript `client.chatConnections` (0.9.0+) or Python
`client.chat_connections` (0.6.0+) for connection configuration.

Read [setup](https://docs.blazingagents.com/platform/chat-integrations) before
creating a connection, including registering the returned `webhookUrl` on the platform. Read the
[TypeScript](https://docs.blazingagents.com/sdk/typescript/chat-integrations) or
[Python](https://docs.blazingagents.com/sdk/python/chat-integrations) SDK reference
for exact arguments. Keep bot credentials in environment variables;
report only IDs, enabled state, and safe health results.

The resource provides list, get, create, update, credential rotation, health checks,
enable, disable, and delete. Update accepts only `name` and `configuration`;
BA generates `webhookUrl`. Changing the Agent or bot requires a new connection. The `chatDeliveries`
resource (Python `chat_deliveries`) is an attention feed: failed and
ambiguous replies and approval cards across every connection.

- Create: resolve the Agent, verify the intended bot/installation, create once
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
Use `/reset` only to replace a deleted Session mapping; active Sessions stay intact.
