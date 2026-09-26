# Serve many end users from one account

You will tag every conversation, Task, Prompt, and Memory with your own user ID, then list and filter each user's work. One Tenant key on your backend serves all your users.

## When to use this

Your product has signed-in users, and each one needs their own chat history, background jobs, remembered preferences, or usage numbers. If you only need a single chat box first, read [Add chat to your app](chat-in-your-app.md). If you want to show or bill usage per user, read [Show usage and bill your users](usage-dashboards.md).

## How it works

Your Tenant key can reach everything in your account, so Blazing Agents never sees your end users as accounts. Instead, you attach Attribution: an opaque `userId` string plus an optional `metadata` object. A Session takes the Attribution of its first Turn. A Task passes its `userId` and `metadata` to every Task run, and to the run's Session and usage. A Memory with a `userId` reaches only Turns that pass the same `userId`. List calls accept `userId` as a filter: omit it for everything, pass `""` for work with no user, or pass an ID for that user.

Attribution is a label, not access control. Your backend signs the user in, checks they own the Session or resource, and only then calls Blazing Agents with IDs from your own storage.

## Build it

1. Stamp every chat Turn with the signed-in user, and check Session ownership before you resume one. `createChatRelay` does both: it rejects a `sessionId` whose stored owner is not the current user, and records the owner of each new Session.

```ts
import {
  BlazingAgents,
  createChatRelay,
  type SessionOwnershipStore,
} from "@blazingagents/sdk";

declare const sessions: SessionOwnershipStore;
declare function signedInUser(
  request: Request
): Promise<{ id: string; orgId: string } | null>;

const client = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});

export const POST = createChatRelay({
  client,
  sessions,
  async resolveContext(request) {
    const user = await signedInUser(request);
    if (!user) return null;
    return {
      agentId: "ag_0123456789abcdef",
      userId: `app:${user.id}`,
      metadata: { orgId: user.orgId },
    };
  },
});
```

Python has no relay helper, so do the same checks yourself:

```python
from collections.abc import Iterator

from blazing_agents import BlazingAgents

client = BlazingAgents()


def owner_of(session_id: str) -> str | None: ...
def record_owner(session_id: str, user_id: str) -> None: ...


def run_turn(
    app_user_id: str, session_id: str | None, message: dict[str, object]
) -> Iterator[bytes]:
    user_id = f"app:{app_user_id}"
    if session_id is not None and owner_of(session_id) != user_id:
        raise PermissionError("Session is not available.")
    if session_id is None:
        stream = client.chat(
            agent_id="ag_0123456789abcdef", message=message, user_id=user_id
        )
    else:
        stream = client.chat(
            agent_id="ag_0123456789abcdef",
            session_id=session_id,
            message=message,
            user_id=user_id,
        )
    with stream:
        if session_id is None:
            record_owner(stream.session_id, user_id)
        yield from stream
```

2. Create background work, saved Prompts, and Memories with the same `userId`. A Task's `userId` cannot change later and is copied to every run.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const client = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});
const agentId = "ag_0123456789abcdef";
const userId = "app:user-42";

await client.tasks.create({
  agentId,
  name: "Weekly digest",
  prompt: "Summarize this week's open items.",
  submit: true,
  userId,
  metadata: { plan: "pro" },
});

await client.prompts.create({
  name: "user-42-standup",
  template: "Write my standup for {{project}}.",
  agentId,
  userId,
});

await client.memories.create({
  agentId,
  text: "Prefers short bullet-point answers.",
  userId,
});
```

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()
agent_id = "ag_0123456789abcdef"
user_id = "app:user-42"

client.tasks.create(
    agent_id=agent_id,
    name="Weekly digest",
    prompt="Summarize this week's open items.",
    submit=True,
    user_id=user_id,
    metadata={"plan": "pro"},
)
client.prompts.create(
    name="user-42-standup",
    template="Write my standup for {{project}}.",
    agent_id=agent_id,
    user_id=user_id,
)
client.memories.create(
    agent_id=agent_id, text="Prefers short bullet-point answers.", user_id=user_id
)
```

A Prompt's `userId` only labels it for listing. Pass `userId` on the chat or generation call that runs the Prompt so the Turn is attributed too.

3. List one user's Sessions for one Agent, and build an inbox across Agents with one row per Agent.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const client = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});
const userId = "app:user-42";

const history = await client.sessions.list({
  agentId: "ag_0123456789abcdef",
  userId,
  limit: 25,
});
for (const session of history.data) {
  console.log(session.id, session.lastMessagePreview, session.updatedAt);
}

const inbox = await client.sessions.listLatest({ userId, byAgent: true });
for (const row of inbox.data) {
  console.log(row.agentId, row.status, row.id, row.lastMessagePreview);
}
```

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()
user_id = "app:user-42"

history = client.sessions.list(agent_id="ag_0123456789abcdef", user_id=user_id, limit=25)
for session in history.data:
    print(session.id, session.last_message_preview, session.updated_at)

inbox = client.sessions.list_latest(user_id=user_id, by_agent=True)
for row in inbox.data:
    print(row.agent_id, row.status, row.id, row.last_message_preview)
```

Both return a `nextCursor` (`next_cursor` in Python). Pass it back as `cursor` for the next page. Without `byAgent`, one Agent can appear several times.

4. Filter the rest of the user's work the same way.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const client = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});
const agentId = "ag_0123456789abcdef";
const userId = "app:user-42";

const tasks = await client.tasks.list({ userId });
const prompts = await client.prompts.list({ userId });
const memories = await client.memories.list({ agentId, userId });
const usage = await client.usage.get({ userId, groupBy: "day" });

console.log(
  tasks.data.map((task) => task.latestRun?.status),
  prompts.prompts.length,
  memories.data.length,
  usage.totals.inputTokens + usage.totals.outputTokens
);
```

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()
agent_id = "ag_0123456789abcdef"
user_id = "app:user-42"

tasks = client.tasks.list(user_id=user_id)
prompts = client.prompts.list(user_id=user_id)
memories = client.memories.list(agent_id=agent_id, user_id=user_id)
usage = client.usage.get(user_id=user_id, group_by="day")

print(
    [task.latest_run.status if task.latest_run else None for task in tasks.data],
    len(prompts.prompts),
    len(memories.data),
    usage.totals.input_tokens + usage.totals.output_tokens,
)
```

## Gotchas

- Taking `userId` or `sessionId` from the browser as proof of identity lets one user read another's chat. Derive `userId` from your sign-in, and check the Session owner in your own database before resuming or reading messages.
- An empty filtered list is not a permission check. `sessions.messages()` still returns any Session ID in your account. Authorize the ID first.
- Omitting `userId` records the work with `""`, the no-user label. Such Turns see only general Memories, and the usage lands in the tenant-level bucket. Require a user ID in your backend.
- A `userId` never changes after creation. Use a stable, opaque ID such as `app:<internal id>`, not an email address that can change and exposes personal data.
- A Session keeps the `metadata` of its first Turn. Send the same `userId` and `metadata` on every Turn of a Session.
- Keep secrets and personal data out of `metadata`. Validate it on your backend like any other product data.

## Check it works

- Sign in as user A and start a chat. `sessions.list({ agentId, userId })` for A contains the new Session; the same call for user B does not.
- As user B, send user A's `sessionId` to your backend. Your backend rejects it before any Blazing Agents call.
- On an Agent with `memoryInjectionEnabled: true`, save a Memory for user A, then ask a fresh question as A. The reply follows the Memory. Ask the same question as user B; it does not.
- Create two Sessions for A on different Agents. `sessions.listLatest({ userId, byAgent: true })` returns one row per Agent.

## Go deeper

- [Tenancy and end-user attribution](https://docs.blazingagents.com/platform/tenancy-and-attribution)
- [Sessions and turns](https://docs.blazingagents.com/platform/sessions-and-turns)
- [Memory](https://docs.blazingagents.com/agents/memory)
- [Sessions: TypeScript](https://docs.blazingagents.com/sdk/typescript/sessions), [Python](https://docs.blazingagents.com/sdk/python/sessions)
- [Tasks: TypeScript](https://docs.blazingagents.com/sdk/typescript/tasks), [Python](https://docs.blazingagents.com/sdk/python/tasks)
- Example with per-user Session ownership: [nextjs-ai-sdk](https://github.com/blazingagents/examples/tree/main/nextjs-ai-sdk), [vite-fastapi-ai-sdk](https://github.com/blazingagents/examples/tree/main/vite-fastapi-ai-sdk)
