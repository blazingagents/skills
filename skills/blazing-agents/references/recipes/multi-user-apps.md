# Serve many end users from one account

Use one Tenant key on your backend and let BA enforce ownership for each signed-in user's resources.

## When to use this

Your product has signed-in users who need their own Agents, chat history, Tasks, files, Memory, or usage. For the chat UI, read [Add chat to your app](chat-in-your-app.md).

## How it works

Your backend authenticates the user and selects their scope. `tenant.forUser(verifiedUserId)` (`client.for_user(verified_user_id)` in Python, `client.for_user(user_id)?` in Rust, `client.ForUser(userID)` in Go) returns an End-user scoped client that sends `X-BA-User-Id` on every request. BA fills in missing Attribution, rejects a conflicting `userId`, and checks resource ownership. A different user's resource returns `not_found` (404). The Agent and related resources must belong to the scoped user.

The API key still grants Tenant authority. Keep it on the backend. A body or list filter `userId` alone is only Attribution; an unscoped client retains access across the Tenant. Keep Tenant administration on that unscoped client in trusted code.

Scope decides how many Agents you run. A scoped request reaches only an Agent and a Workspace owned by the same user, so every user needs their own Agent, Workspace, and Skill copies, created lazily on first use because creation is rate limited (see [Limits](../limits.md)). The alternative is one shared Agent on the unscoped client, where your backend checks which user owns which Session. A shared Agent shares one Workspace across all its users: one user's Turn can read files another user's Turn wrote, and its 500-note Memory pool is shared too. [Choose a design](../choosing.md#how-many-agents-one-shared-one-per-end-user-or-one-per-job) compares the two.

## Build it

For a Python, Rust, or Go backend, read the code for these steps in [Python](multi-user-apps.python.md), [Rust](multi-user-apps.rust.md), [Go](multi-user-apps.go.md).

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

Python `for_user()` does the same. The ID must come from verified sign-in.

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

All four SDKs take the idempotency key on Task creation. Read [Background work](background-and-scheduled.md) for retry behavior.

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

List responses expose `data` and `nextCursor`. Pass the cursor back until it is `null`. Agent and Prompt pages hold 50 items by default and 100 at most. A name lookup must inspect every page and handle multiple matches.

## Gotchas

- Choose a stable opaque user ID with 1 to 256 printable ASCII characters and no surrounding spaces. Use the same value when provisioning resources and making scoped calls.
- Never forward a browser-supplied `X-BA-User-Id` as proof of identity. Derive it from verified sign-in.
- Tenant-owned or another user's Agent cannot serve a scoped request. Create the Agent and its user-owned dependencies for that user.
- Scope is immutable for each client. Do not store one user's scoped client in a global variable reused by other requests.
- Tasks retain the scope selected at creation. A Task created without that scope, or under another user's scope, fails with `forbidden` (403) when a scoped client runs or changes it; create it through the user scope from the start.
- A body `userId` that disagrees with the scope fails. Omit it when the scope already supplies the value.
- Use scoped `usage.get()`, `usage.getForAgent()`, or `usage.sessions()` for a user's dashboard. Never drop the scope from an End-user operation to make it succeed.

## Tenant administration

A scoped client cannot reach these; make the calls from the unscoped client in trusted backend code:

- Providers, their models, and thinking levels.
- MCP Connections: create, update, test, reconnect, delete. A scoped client can still list and toggle the MCP attachments of the user's own Agent.
- Chat Connections (Slack and Telegram).
- The merchant connection, customer bindings, and merchant usage events.
- Tenant settings and the quota.
- Tenant and Agent model spending limits.
- The usage overview across all users.
- The Admin Agent.

## When a scoped call fails

| Error | Cause | Fix |
| --- | --- | --- |
| `not_found` (404) | The Agent, Session, Artifact, or other record is Tenant-level or belongs to another user. | Create the Agent for this user, or check the user ID passed to `forUser`. |
| `workspace_not_found` (404) | The user's Agent is attached to a Workspace the user does not own. | Create the Workspace with this user's `userId`, or let `agents.create` on the scoped client make one. |
| `forbidden` (403) | A Tenant administration call, or a Task created under another scope. | Call it from the unscoped client in trusted code, or recreate the Task through this scope. |
| `invalid_request` (400) | A body `userId` differs from the scope. | Omit `userId`; the scope supplies it. |
| `insufficient_scope` (403) | The API key is read-only and the call creates, changes, or deletes something. | Use a full key for setup code; keep the read key for chat and reads. |
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
