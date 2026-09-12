# Slack and Telegram connections

Use BA's managed Chat Connections when the user wants an existing Agent in Slack
or Telegram. BA hosts Vercel Chat SDK, Sessions, replies, and approval cards.
Use the existing SDK for Agent configuration and authenticated REST for connections.

Read [setup](https://docs.blazingagents.com/platform/chat-integrations) before
creating a connection, including saving the final callback URL after creation. Read the
[REST reference](https://docs.blazingagents.com/api-reference/rest-api/chat-connections)
for request bodies and operations. Keep bot credentials in environment variables;
report only IDs, enabled state, and safe health results.

- Create: resolve the Agent, verify the intended bot/installation, create once,
  PATCH its top-level `webhookUrl` with the returned ID's callback path, register
  that URL in the platform, run health, and test a real reply.
  Platform registration is separate from BA connection creation.
- Inspect: list/get connections, then run health if fresh evidence is needed.
  `unknown` requires manual verification; token validity does not prove delivery.
- Rotate: replace the complete credentials for the same installation. Preserve
  Sessions; update Telegram's registered secret when changing it.
- Disable/delete: explain that disable stops new intake while admitted work may
  finish; delete preserves Sessions and leaves platform registration unchanged.
- Repair: list deliveries first. Require confirmation that the previous sender
  stopped and that duplicate output is acceptable; use the observed attempt.
  After an uncertain result, read delivery state instead of sending again.
  Repair sends persisted output and must never rerun the Agent or its tools.

Sender/approver policy is unrestricted. Destination IDs are health probes, not
allowlists. Any participant with access to a bound approval card can decide.
Use `/reset` only to replace a deleted Session mapping; active Sessions stay intact.
