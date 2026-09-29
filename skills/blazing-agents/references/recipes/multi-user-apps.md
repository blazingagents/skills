# Serve many end users from one account

Use one Tenant key on your backend and let BA enforce ownership for each signed-in user's resources.

## When to use this

Your product has signed-in users who need their own Agents, chat history, Tasks, files, Memory, or usage. For the chat UI, read [Add chat to your app](chat-in-your-app.md).

## How it works

Your backend authenticates the user and selects their scope. TypeScript `client.forUser(userId)` sends `X-BA-User-Id` on every request. BA fills in missing Attribution, rejects a conflicting `userId`, and checks resource ownership. A different user's resource returns `not_found` (404). The Agent and related resources must belong to the scoped user.

The API key still grants Tenant authority. Keep it on the backend. A body or list filter `userId` alone is only Attribution; an unscoped client retains access across the Tenant. Keep Tenant administration on that unscoped client in trusted code.

These examples require the updated API and SDK contracts described in [the TypeScript reference](../sdk-typescript.md) and [the Python reference](../sdk-python.md). Confirm those prerequisites before adopting them.

## Build it

1. Derive a scoped client from the session your backend verified. Keep that client local to the request.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare function authenticate(request: Request): Promise<{ id: string } | null>;
const tenant = new BlazingAgents({
  apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "",
});

export async function GET(request: Request): Promise<Response> {
  const principal = await authenticate(request);
  if (!principal) return new Response("Sign in first.", { status: 401 });
  const client = tenant.forUser(`app:${principal.id}`);
  return Response.json(await client.agents.list({ limit: 50 }));
}
```

Python has no `for_user()` helper. Pass the header on each end-user call, including subsequent pages. The ID must come from verified sign-in.

```python
from blazing_agents import BlazingAgents

client = BlazingAgents()


def list_my_agents(verified_user_id: str):
    return client.agents.list(
        limit=50, extra_headers={"X-BA-User-Id": f"app:{verified_user_id}"}
    )
```

2. Create user-owned resources through that scope. Select the Provider and model in trusted backend configuration. Agent and Prompt names can repeat; store the returned IDs.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const tenant: BlazingAgents;
declare const verifiedUserId: string;
declare const providerId: string;
declare const model: string;

const client = tenant.forUser(verifiedUserId);
const agent = await client.agents.create({
  name: "Assistant",
  providerId,
  model,
});
await client.prompts.create({
  name: "Standup",
  template: "Write my standup for {{project}}.",
  agentId: agent.id,
});
await client.tasks.create({
  agentId: agent.id,
  name: "Weekly digest",
  prompt: "Summarize this week's open items.",
  submit: true,
  idempotencyKey: "weekly-digest:2026-W40",
});
```

Python currently supports idempotency on `tasks.submit()`, not Task creation. Read [Background work](background-and-scheduled.md) for retry behavior.

3. Use the scoped client for chat, history, approvals, downloads, Memory, and usage. BA checks referenced resource IDs, so these calls do not need a separate Session ownership table. Keep any additional product permissions in your backend.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const tenant: BlazingAgents;
declare const verifiedUserId: string;
declare const agentId: string;

const client = tenant.forUser(verifiedUserId);
const history = await client.sessions.list({ agentId, limit: 25 });
const inbox = await client.sessions.listLatest({ byAgent: true });
const prompts = await client.prompts.list({ limit: 50 });
const usage = await client.usage.get({ groupBy: "day" });
console.log(history.data, inbox.data, prompts.data, usage.totals);
```

List responses expose `data` and `nextCursor`. Pass the cursor back until it is `null`. Agent and Prompt pages default to 50 items and allow up to 100; the Prompt collection has no fixed 100-item cap. A name lookup must inspect every page and handle multiple matches.

## Gotchas

- Choose a stable opaque user ID with 1 to 256 printable ASCII characters and no surrounding spaces. Use the same value when provisioning resources and making scoped calls.
- Never forward a browser-supplied `X-BA-User-Id` as proof of identity. Derive it from verified sign-in.
- Tenant-owned or another user's Agent cannot serve a scoped request. Create the Agent and its user-owned dependencies for that user.
- Scope is immutable for each client. Do not store one user's scoped client in a global variable reused by other requests.
- Tasks retain the scope selected at creation. A Task created without that scope cannot later be enabled or run through a scoped client; create it through the user scope from the start.
- A body `userId` that disagrees with the scope fails. Omit it when the scope already supplies the value.
- The scoped TypeScript client omits Tenant administration, usage overview, and per-Agent usage. Use scoped `usage.get()` or `usage.sessions()` for a user's dashboard.
- Python exposes Tenant methods even when you pass the scope header. BA rejects unsupported scoped routes; do not remove the header to make an end-user operation succeed.
- On sign-out or account switch, stop streams, discard pending responses, clear user caches, and remount the chat transport. Namespace persisted Session IDs by the authenticated user.

## Check it works

- Create Agents for A and B with the same display name. Both succeed and have distinct IDs.
- As A, create a Session, Task, Prompt, and Memory. B's scoped lists omit them.
- As B, read or resume A's Session and download A's Artifact. BA returns 404.
- Pass a body `userId` that differs from the scope. The request fails.
- Create more than one page of Agents or Prompts and follow every `nextCursor`; each item appears once.
- Switch accounts while a chat streams or history loads. No old-user content appears under the new account.

## Go deeper

- [Tenancy and end-user attribution](https://docs.blazingagents.com/platform/tenancy-and-attribution)
- [TypeScript scoped clients](https://docs.blazingagents.com/sdk/typescript/client#for-user)
- [Session history](chat-in-your-app.md), [Task retries](background-and-scheduled.md), [exact Session usage](usage-dashboards.md)
