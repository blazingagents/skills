# Choose a design

Use this page when the user asks which BA feature fits, compares two options,
or describes a product and asks how to build it on BA. Each section names the
decision, the options, when each fits, and the facts that decide it. Numbers
come from [Limits](limits.md). Build each option with the recipe it links.

Give the user a recommendation, not a list. State the deciding fact for their
case, and say what would change the answer.

## How work starts: chat, Task, or one-shot generation

- **Chat Session** (`chat()`): a person waits and the conversation continues.
  Only chat can pause for a Tool approval and call backend functions.
- **Task** (optionally scheduled): no one waits, the work repeats, or it must
  run exactly once (an idempotency key returns the same run on retry).
- **One-shot generation** (`completion()`, `object()`): one transform with no
  history and no published files. It is metered like any Turn, and a failure
  after streaming starts ends the stream early with status 200, so check how
  the stream finished.

Deciding facts:

- Interactive Turns and stateless generation share one concurrency pool (25
  on Developer, 50 on Pro). A request over it fails at once with
  `429 rate_limited` and no `Retry-After`, so back off in your backend. Task
  runs have their own pool (50 or 100), and extra runs wait as `queued`. Move background work to
  Tasks so it never takes a chat user's slot.
- Every Turn stops at the Turn deadline (30 minutes) and after 64 model
  steps. Split longer work into several Task runs.
- A Task has at most one active run; a schedule fire that lands while one runs
  is skipped, and missed fires are not caught up.
- Only chat Sessions and Task runs can publish Artifacts. A Task run's
  transcript appears when the run ends; it does not stream.
- Chat has no output schema. When a conversation must end in typed data, give
  the Agent a backend function that receives the result, or call `object()`
  over the transcript afterwards.

Build: [Chat in your app](recipes/chat-in-your-app.md),
[Background and scheduled work](recipes/background-and-scheduled.md),
[Structured output](recipes/structured-output.md).

## How the Agent acts: built-in tool, backend function, or MCP tool

- **Built-in tools**: files and shell in the Workspace, planning, Memory, and
  web search.
- **Backend function**: code in the user's backend that only interactive chat
  needs. It runs in the backend process that relays the chat stream.
- **MCP tool**: anything a Task, one-shot generation, or Slack or Telegram bot
  must reach, and third-party servers.

Deciding facts: a backend function is attached per chat request, never saved
on the Agent, and must answer within 60 seconds. MCP tools work in every kind
of Turn, are limited to 128 per connection and 256 per Turn, and an MCP
attachment can forward the End-user's `userId` and metadata to the server.

Build: [Backend functions](recipes/backend-functions.md),
[External tools with MCP](recipes/external-tools-mcp.md),
[Web search](recipes/web-search.md).

## Where knowledge lives: instructions, Prompt, Skill, Memory, or files

- **Instructions**: rules for every Turn. At most 3,000 characters, so long
  procedures do not fit.
- **Prompt**: a reusable input for one Turn, with `{{variables}}`.
- **Skill**: long procedures and reference material, loaded only when a task
  matches. Up to 100 Skills per Agent, each up to 100 files and 10 MiB.
- **Memory**: short facts that carry across Sessions. Each note is at most
  10 KiB. An Agent holds 500 notes in one pool shared by all its End-users, and
  the least recently used notes are evicted silently when it is full. A
  `forUser` Turn sees only that user's notes, never the Agent's general ones.
- **Workspace files**: working data the Agent produces. The app cannot read
  them; publish an Artifact for anything the app or user must download.

Deciding facts: an existing Session keeps the instructions from its first
Turn, while Skills and Memory are always read current. Skill files never appear
in the Workspace, so `bash` cannot read them. Product data that the app also
queries belongs in the app's own database, reached through a backend function
or an MCP tool.

Build: [Shape agent behavior](recipes/shape-agent-behavior.md),
[Files and deliverables](recipes/files-and-deliverables.md).

## How many Agents: one shared, one per End-user, or one per job

- **One shared Agent**: every End-user gets the same behavior and nobody needs
  private files or private Memory.
- **One Agent per End-user**: BA should enforce ownership with `forUser`, or
  End-users must not see each other's files or Memory.
- **One Agent per job**: jobs need different tools, approval policies, MCP
  attachments, or models.

Deciding facts:

- **An unscoped shared Agent shares one Workspace across all End-users.** Every
  Session of an Agent runs in the same `/workspace`, with no per-Session or
  per-user separation. A file one End-user's Turn writes, another's can read,
  and on Plus those files persist. If End-users must not see each other's
  files, use per-user Agents with their own Workspaces and `forUser`, or turn
  off the file tools on the shared Agent.
- A `forUser` request reaches only an Agent and Workspace owned by that same
  End-user. A Tenant-level Agent answers `404` to a scoped request, so scope
  forces per-user Agents.
- An Agent holds its tools, approval policies, Skills, and Memory pool. Every
  per-user Agent needs its own Skill copies, and a configuration change must be
  applied to each Agent.
- Creating Agents, Workspaces, and Tasks is limited to 60 per minute and
  1,000 per day each. Create a user's Agent lazily, on first use, not in bulk:
  10,000 users provisioned up front take 10 days.
- Plans do not cap the number of Agents, and an idle Agent with an unused
  Workspace runs no compute.
- Providers and MCP Connections stay Tenant configuration either way.
- A model spending limit is set per Agent or for the Tenant, so only per-user
  Agents give each user their own spend cap.

Build: [Multi-user apps](recipes/multi-user-apps.md).

## Who enforces End-user access: `forUser` or your backend

- **`forUser(userId)`**: per-user resources. BA binds new resources to the
  user, filters lists, and answers `404` for another user's records. The user
  ID must come from verified sign-in.
- **Unscoped client with `userId` labels**: shared Agents and Tenant
  administration. A body or filter `userId` only labels work; your backend must
  check who may reach which Session.

Deciding facts: a scoped client cannot call Tenant administration (Providers,
MCP and Chat Connections, spending limits, merchant billing, Tenant settings,
usage overview). The scope is fixed per client, and a scoped client can change or run only
Tasks created under the same scope. A relay that resumes a Session ID from the browser on an
unscoped client lets any user continue any Session.

Build: [Multi-user apps](recipes/multi-user-apps.md).

## Which API key: read or full

- **Read key** (`ba_read_`): a backend that only chats, runs Tasks, and reads.
  Also the key for coding agents and the BA MCP server.
- **Full key** (`ba_full_`): code that creates or changes Agents, Skills,
  Workspaces, Tasks, Memories, Prompts, Providers, or connections.

Deciding facts: a key's access never changes after creation. A read key still
spends credit, creates Sessions, and lets the Agent use its tools. A write with
a read key fails with `403 insufficient_scope`. A Chat Connection Turn uses no
API key and runs with full authority. Keys are created in the dashboard only.

## Workspace: Core or Plus, private or shared

- **Core**: scratch work inside one stretch of activity. Files vanish when the
  Workspace stops after about 10 idle minutes.
- **Plus**: files a later Session or Task run must find.
- **Shared Workspace**: several Agents working on the same files.

Deciding facts: the tier is permanent. Each shell command is killed after 30
seconds, so long installs and test suites must be split or backgrounded. Plus
discards saved files after 29 days unused, and a failed save starts the next
run empty, so keep anything important in an Artifact or in git. Switching the
network policy between unrestricted and restricted stops the Workspace, which
loses Core files. Compute is billed while the Workspace runs; creating one is
free.

Build: [Files and deliverables](recipes/files-and-deliverables.md).

## Conversation lifetime: continue, new Session, or fork

- **Continue** for the same topic.
- **New Session** to apply Agent edits or to drop a long context.
- **Fork** to branch from an earlier reply without losing the original.

Deciding facts: a Session keeps the Agent configuration from its first Turn.
Compaction summarizes older messages when the context grows. A fork shares the
Agent's Workspace and Memory with its source.

Build: [Chat in your app](recipes/chat-in-your-app.md),
[Shape agent behavior](recipes/shape-agent-behavior.md).

## Human control: approval modes

Each tool runs `full`, `deny`, `manual` (a person decides), or `auto` (the model
reviews the call and asks a person when unsure), with separate policies for
chat and Tasks.

Deciding facts: Tasks and one-shot generation cannot wait for a person, so a
call that needs one is denied there. Approval authorizes one exact call; it is
not access control. Anyone who sees a Slack or Telegram approval card can
decide it.

Build: [Human approval](recipes/human-approval.md).

## Where users chat: your UI or a Chat Connection

Deciding facts: a Chat Connection has no sender allowlist, and all its
conversations share the Agent's Workspace. Its Turns run with no End-user
scope and full key authority; their `userId` names the person in a direct
message but the whole thread in a shared conversation, so per-user tools,
usage, and billing see one user per thread. A Turn started through the API on a bot's Session does not post to
the chat. A message sent while the Agent answers is steered into that answer.

Build: [Slack and Telegram](recipes/slack-and-telegram.md),
[Chat in your app](recipes/chat-in-your-app.md).

## Cost controls: quota, spending limit, or End-user guardrail

- **Quota**: a token or request ceiling for the whole Tenant.
- **Model spending limit**: an estimated dollar ceiling per Agent or Tenant.
- **Merchant guardrail**: refuse Turns for End-users whose own plan or balance
  fails, when the user bills End-users through Polar or Dodo.

Deciding facts: all three can be overshot by a Turn already running. To stop
spend at once, disable the Agent, stop the Turn with `sessions.stop()`, or
cancel the Task run. BA refuses Turns with `usage_credit_required` (402) when
the Tenant's own Usage credit runs out. A model
response with no reported cost stops the Turn under a spending limit, which
custom Providers can hit. Web search is billed by BA as Usage credit and is not
capped by spending limits. An End-user with no customer binding is never
billed.

Build: [Usage and billing](recipes/usage-dashboards.md).

## How to set up: code, dashboard, BA MCP server, or ba-admin

- **Code**: setup that must be checked in, repeated per environment, or
  created per End-user.
- **Dashboard**: Providers, MCP Connections with credentials, the merchant
  connection, and API keys.
- **BA MCP server or the `ba-admin` skill**: one-off inspection and changes
  from a coding agent, with a read key by default.

Deciding facts: API keys exist only in the dashboard. The BA MCP server cannot
create Providers, MCP Connections, or Chat Connections.
