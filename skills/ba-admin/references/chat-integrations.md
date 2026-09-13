# Slack and Telegram connections

Use BA's managed Chat Connections when the user wants an existing Agent in Slack
or Telegram. BA hosts Vercel Chat SDK, Sessions, replies, and approval cards.
Use TypeScript `client.chatConnections` (0.9.0+) or Python
`client.chat_connections` (0.6.0+) for connection configuration.

Read [setup](https://docs.blazingagents.com/platform/chat-integrations) before
creating a connection, including saving the final callback URL after creation. Read the
[TypeScript](https://docs.blazingagents.com/sdk/typescript/chat-integrations) or
[Python](https://docs.blazingagents.com/sdk/python/chat-integrations) SDK reference
for exact arguments. Keep bot credentials in environment variables;
report only IDs, enabled state, and safe health results.

The resource provides list, get, create, update, credential rotation, health checks,
enable, disable, and delete. Update accepts only the name and callback URL;
changing the Agent or bot requires a new connection.

- Create: resolve the Agent, verify the intended bot/installation, create once with intake disabled,
  update the saved callback URL using the returned ID, register that URL in the
  platform, run health, enable, and test a real reply.
  Platform registration is separate from BA connection creation.
- Inspect: list/get connections, then run health if fresh evidence is needed.
  `unknown` requires manual verification; token validity does not prove delivery.
- Rotate: replace the complete credentials for the same installation. Preserve
  Sessions; update Telegram's registered secret when changing it.
- Disable/delete: explain that disable stops new intake while admitted work may
  finish; delete preserves Sessions and leaves platform registration unchanged.

Sender/approver policy is unrestricted. Destination IDs are health probes, not
allowlists. Any participant with access to a bound approval card can decide.
Use `/reset` only to replace a deleted Session mapping; active Sessions stay intact.
