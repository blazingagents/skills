# TypeScript SDK reference

Use this page to write backend TypeScript that calls Blazing Agents: install the
client, run chat, text, and structured output, call every resource method, page
through lists, handle errors, and connect `useChat` to your own backend.

The examples for user scope, paginated Agents and Prompts, session usage, and
backend functions require TypeScript SDK 0.16.0 or newer. Session inputs
(steering and Stop), multi-message chat, and approval continuations require
0.20.0 or newer. Session forking requires 0.21.0 or newer. Check the installed package's types before using these APIs.

For the same surface in Python, read [Python SDK reference](sdk-python.md). For
end-to-end builds, start from a recipe such as
[Add chat to your app](recipes/chat-in-your-app.md).

## Install

```bash
npm install @blazingagents/sdk ai@^7
```

- `ai` (AI SDK 7) is a peer dependency. The SDK re-exports its `UIMessage` type.
- The SDK requires Node.js 24 or newer and ships ESM only.
- Add `@ai-sdk/react` only in the frontend that renders `useChat`.
- Runtime Zod schemas for request and response bodies live in
  `@blazingagents/sdk/contracts`. Types for the common bodies are exported from
  the root package.

## Construct the client

Create one client per Tenant API key on your backend and reuse it. The key comes
from `BLAZING_AGENTS_API_KEY`. Never ship it to a browser.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
if (!apiKey) {
  throw new Error("BLAZING_AGENTS_API_KEY is required");
}

export const client = new BlazingAgents({
  apiKey,
  // Optional. Defaults to https://api.blazingagents.com.
  baseUrl: process.env.BLAZING_AGENTS_BASE_URL,
  // Optional. Sent as X-Client-Request-Id on every call.
  clientRequestId: "checkout-service",
  // Optional. Called once per HTTP response; errors thrown here are ignored.
  onResponse: ({ method, path, status, durationMs, requestId }) => {
    console.log(method, path, status, Math.round(durationMs), requestId);
  },
});
```

| Option | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `string` | Required. Tenant API key, sent as `Authorization: Bearer`. |
| `baseUrl` | `string` | API origin. Default `https://api.blazingagents.com`. Trailing slashes are removed. |
| `fetch` | `(input, init) => Promise<Response>` | Custom fetch, for example a native streaming fetch in React Native. |
| `clientRequestId` | `string` | Your correlation ID, sent as `X-Client-Request-Id`. Up to 128 chars of `A-Za-z0-9._:-`. |
| `onResponse` | `(obs: ResponseObservation) => void` | Metrics hook. Receives `method`, `path`, `status`, `durationMs`, `requestId`, `clientRequestId`. |

Per-call options:

- Every resource and generation method takes one request object. Pass
  `abortSignal` in it to cancel. Cancellation stops the request; it does not roll
  back a mutation the server already accepted.
- `chat`, `completion`, and `object` also accept `clientRequestId` per call.
- `client.withOptions({ clientRequestId })` returns a client view that tags every
  call with that ID. Use it to tie one inbound request to all its BA calls.

### End-user scope

After authenticating a user in your backend, call `client.forUser(userId)` to
bind their ID to requests. The server checks ownership and attributes new
resources and Turns to that user. Pass only a trusted ID; the scoped client
sends it as `X-BA-User-Id`. It exposes user operations, including generation,
Agents, Prompts, Sessions, Tasks, and `usage.get` / `usage.sessions`; Tenant
administration and Tenant-wide usage methods stay on the root client. Its
`withOptions` view keeps the user scope. Its `chat` and `continueChat` accept
backend `functions` like the root client's.

```ts
import type { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const authenticatedUser: { id: string };
declare const sessionId: string;

const user = client.forUser(authenticatedUser.id);
const page = await user.agents.list({ limit: 50 });
const usage = await user.usage.sessions({ sessionIds: [sessionId] });
```

`userId` must be printable ASCII, at most 256 characters, with no leading or
trailing spaces. Authenticate before creating the scoped view; the Tenant API
key remains on the backend.

## Generate output

The root client has three generation methods. All three take `agentId`, and
`userId` plus `metadata` for Attribution. Pass the ID of the end user who caused
the Turn as `userId`; omitting it records the Turn at Tenant level with no user.

| Method | Use it for | State |
| --- | --- | --- |
| `client.chat(input)` | Conversations. Creates a Session or resumes one. | Stateful: history lives in the Session. |
| `client.completion(input)` | One-shot text, streamed. | Stateless: no Session. |
| `client.object(input)` | One-shot JSON that matches a JSON Schema. | Stateless: no Session. |

### Chat

`chat` input:

| Field | Notes |
| --- | --- |
| `agentId` | Required. |
| `message` | A `UIMessage` from the user. Or send `promptId` (plus optional `variables`) instead. |
| `messages` | Several user `UIMessage`s run in one Turn, in order, each saved to history. Use it to send the messages that waited in your own queue while the Session was busy. Mutually exclusive with `message` and `promptId`. |
| `sessionId` | Omit to create a Session. Pass an `ss_` ID to resume it. |
| `trigger` | `"submit-message"` (default) or `"regenerate-message"`. Regenerate needs `sessionId`. |
| `messageId` | Optional client message ID. |
| `userId`, `metadata` | Attribution. |
| `functions` | Backend functions for this call, built with `defineFunction`. See [Backend functions](#backend-functions). |
| `abortSignal`, `clientRequestId` | Request options. |

`chat` resolves to a `ChatResult`:

| Accessor | Returns | Notes |
| --- | --- | --- |
| `sessionId` | `Promise<string>` | The new server-minted `ss_` ID on create, or the ID you passed on resume. Store it to resume later. |
| `toResponse()` | `Response` | An AI SDK UI message stream (SSE) you can return from a handler as-is. |
| `toStream()` | `ReadableStream<Uint8Array>` | The same SSE bytes without building a `Response`. For runtimes whose `Response` cannot stream. |
| `requestId` | `string \| undefined` | BA's `x-request-id`. Quote it in support requests. |

The body can be claimed once. Call `toResponse()` or `toStream()`, not both.

```ts
import { BlazingAgents, type UIMessage } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare function saveSessionId(userId: string, sessionId: string): Promise<void>;

export async function relayChat(
  userId: string,
  message: UIMessage,
  sessionId: string | undefined
): Promise<Response> {
  const result = await client.chat(
    sessionId === undefined
      ? { agentId: "ag_0123456789abcdef", message, userId }
      : { agentId: "ag_0123456789abcdef", message, userId, sessionId }
  );
  if (sessionId === undefined) {
    await saveSessionId(userId, await result.sessionId);
  }
  return result.toResponse();
}
```

### Backend functions

`defineFunction({ description, inputSchema, execute })` declares a function whose
handler runs in your backend. `inputSchema` is a Zod schema for an object;
`execute` receives the parsed input and `{ idempotencyKey, signal }` and returns
a plain JSON value or a promise of one. Attach the map as `functions` on `chat`;
the SDK sends the model only names, descriptions, and schemas, runs approved
calls in your process, and strips the private events from the stream. Function
names start with a letter and allow up to 64 letters, digits, `_`, or `-`;
built-in names and the `mcp__` prefix are reserved.

After a chat Turn pauses for tool approvals, collect every pending approval's
decision and call
`continueChat({ agentId, sessionId, decisions, functions, abortSignal?, clientRequestId? })`
with the same handlers. It records the complete round and streams the
continuing Turn as a `ChatResult`. For end-to-end setup, including scoping and
approval flow, read [backend functions](recipes/backend-functions.md).

### Completion

`completion` takes `agentId` and either `prompt` (a string) or `promptId` plus
optional `variables`. The result has:

- `textStream`: `AsyncIterable<string>` of text deltas.
- `text`: `Promise<string>` with the full text.
- `toResponse()`: a plain-text streaming `Response` (for `useCompletion` with
  `streamProtocol: "text"`). Claim it once.
- `requestId`.

```ts
import type { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;

export async function welcome(userId: string): Promise<string> {
  const result = await client.completion({
    agentId: "ag_0123456789abcdef",
    prompt: "Write a one-line welcome message.",
    userId,
  });
  for await (const delta of result.textStream) {
    process.stdout.write(delta);
  }
  return await result.text;
}
```

### Object

`object` takes the same inputs as `completion` plus a required `schema`: a JSON
Schema object. The result has `partialObjectStream` (`AsyncIterable<unknown>`),
`object` (`Promise<unknown>`), `toResponse()`, and `requestId`. The values are
typed `unknown`; validate `object` with your own schema before you trust it.

```ts
import type { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;

export async function extractInvoice(text: string): Promise<unknown> {
  const result = await client.object({
    agentId: "ag_0123456789abcdef",
    prompt: `Extract the invoice number and total from:\n${text}`,
    schema: {
      type: "object",
      properties: {
        invoiceNumber: { type: "string" },
        total: { type: "number" },
      },
      required: ["invoiceNumber", "total"],
      additionalProperties: false,
    },
  });
  return await result.object;
}
```

## Scope calls to one Agent

Skills are the only Agent-scoped resource object. Get it with
`client.agent({ agentId })`, which takes an object, not a bare string. Other
per-Agent methods take `agentId` in the request object.

```ts
import type { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;

export async function listSkillNames(agentId: string): Promise<string[]> {
  const page = await client.agent({ agentId }).skills.list({ limit: 50 });
  return page.data.map((skill) => skill.name);
}
```

## Operation map

Every method takes a single object. Path parameters such as `agentId` go in the
same object as body fields. All methods also accept `abortSignal`. "Page"
means the result is `{ data, nextCursor }` (see [Pagination](#pagination)).

### Root client

| Method | HTTP | Returns |
| --- | --- | --- |
| `chat(input)` | `POST /v1/agents/{agentId}/sessions[/{sessionId}]` | `ChatResult` |
| `continueChat(input)` | `POST /v1/agents/{agentId}/sessions/{sessionId}/tool-approvals/continue` | `ChatResult`. Takes `decisions` covering every approval in the round and streams the continuing Turn. |
| `completion(input)` | `POST /v1/agents/{agentId}/generation` | `CompletionResult` |
| `object(input)` | `POST /v1/agents/{agentId}/generation` | `ObjectResult` |
| `agent({ agentId })` | none | `{ skills }` |
| `withOptions({ clientRequestId })` | none | `BlazingAgents` |
| `forUser(userId)` | none | `UserClient` for one authenticated user. |

### `client.agents`

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `create(body)` | `POST /v1/agents` | `Agent`. Omit `workspaceId` to get a default Workspace. |
| `list({ userId?, workspaceId?, cursor?, limit? })` | `GET /v1/agents` | Page of Agents (`{ data, nextCursor }`). |
| `get({ agentId })` | `GET /v1/agents/{agentId}` | `Agent` |
| `update({ agentId, ...body })` | `PUT /v1/agents/{agentId}` | `Agent` |
| `delete({ agentId, includeArtifacts })` | `DELETE /v1/agents/{agentId}` | `void`. `includeArtifacts` is required. The Workspace is kept. |
| `enable({ agentId })` | `POST /v1/agents/{agentId}/enable` | `Agent` |
| `disable({ agentId })` | `POST /v1/agents/{agentId}/disable` | `Agent` |
| `uploadAvatar({ agentId, file })` | `POST /v1/agents/{agentId}/avatar` | `Agent`. `file` is a `File`. |
| `removeAvatar({ agentId })` | `DELETE /v1/agents/{agentId}/avatar` | `Agent` |
| `listMcpAttachments({ agentId })` | `GET /v1/agents/{agentId}/mcp-attachments` | `McpAttachmentsResponse` |
| `updateMcpAttachment({ agentId, mcpConnectionId, ...body })` | `PATCH /v1/agents/{agentId}/mcp-attachments/{mcpConnectionId}` | `McpAttachmentResponse` |

### `client.providers`

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `create({ name, providerType, baseUrl, apiKey })` | `POST /v1/providers` | `ProviderResponse`. The key is write-only; responses show `keyFragment`. |
| `list()` | `GET /v1/providers` | `{ providers }`. Not paginated. |
| `get({ providerId })` | `GET /v1/providers/{providerId}` | `ProviderResponse` |
| `update({ providerId, ...body })` | `PATCH /v1/providers/{providerId}` | `ProviderResponse` |
| `delete({ providerId, confirmSnapshotInvalidation? })` | `DELETE /v1/providers/{providerId}` | `void` |
| `listModels({ providerId })` | `GET /v1/providers/{providerId}/models` | `ProviderModelsResponse` |
| `getThinkingLevels({ providerId, model })` | `GET /v1/providers/{providerId}/thinking-levels` | `{ known, levels }` |

### `client.prompts`

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `create(body)` | `POST /v1/prompts` | `PromptResponse` |
| `list({ userId?, agentId?, cursor?, limit? })` | `GET /v1/prompts` | Page of Prompts (`{ data, nextCursor }`). |
| `get({ promptId })` | `GET /v1/prompts/{promptId}` | `PromptResponse` |
| `update({ promptId, ...body })` | `PATCH /v1/prompts/{promptId}` | `PromptResponse` |
| `delete({ promptId })` | `DELETE /v1/prompts/{promptId}` | `void` |

### `client.sessions`

A chat-created Session saves Agent configuration on its first Turn; a fork inherits the source snapshot at creation. Read it with `(await client.sessions.get({ agentId, sessionId })).agentConfig`; message pages contain only transcript messages.

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `list({ agentId, cursor?, limit?, userId? })` | `GET /v1/agents/{agentId}/sessions` | Page of Sessions (`id`, `userId`, `messageCount`, `lastMessagePreview`, `metadata`, timestamps). |
| `listLatest({ byAgent?, userId?, cursor?, limit? })` | `GET /v1/sessions/latest` | Page of the Tenant's most recently updated Sessions, newest first. `byAgent: true` returns at most one per Agent. Items add `agentId`, `model`, `thinkingLevel`, `status`. |
| `get({ agentId, sessionId })` | `GET /v1/agents/{agentId}/sessions/{sessionId}` | `SessionResponse` with `agentConfig` |
| `fork({ agentId, sessionId, messageId, idempotencyKey, abortSignal? })` | `POST /v1/agents/{agentId}/sessions/{sessionId}/fork` | `SessionResponse` with saved `agentConfig` and required nullable `forkedFrom` |
| `messages({ agentId, sessionId, cursor?, after?, limit? })` | `GET /v1/agents/{agentId}/sessions/{sessionId}/messages` | `{ data: SessionMessage[], nextCursor, latestCursor }`; each message has required top-level `branchable`. `cursor` walks older pages; `after` walks forward. Not both. |
| `delete({ agentId, sessionId, deleteArtifacts })` | `DELETE /v1/agents/{agentId}/sessions/{sessionId}` | `void`. `deleteArtifacts` is required. `session_busy` while any Turn runs. |
| `toolApprovals({ agentId, sessionId })` | `GET /v1/agents/{agentId}/sessions/{sessionId}/tool-approvals` | `{ data, continuation }`. Each item has `approvalId`, `toolName`, `input`, `decision` (`pending`, `approved`, `denied`). `continuation` is `{ id, state }` with state `waiting`, `running`, `succeeded`, or `failed`, or `null`. |
| `submitInput({ agentId, sessionId, requestId, message })` | `POST /v1/agents/{agentId}/sessions/{sessionId}/inputs` | `{ data: SessionInput, activity }`. Steers the running Turn; `steer_not_available` (409) when no Turn can take a steer (idle, stopping, or an approval wait) — keep the message in your own queue and send it as ordinary chat later. `requestId` is 1 to 128 characters and not `.` or `..`. Retrying with the same `requestId` and payload returns the same receipt; a changed payload returns `input_idempotency_conflict`. |
| `inputs({ agentId, sessionId, includeCompleted?, limit?, cursor? })` | `GET /v1/agents/{agentId}/sessions/{sessionId}/inputs` | `{ data, nextCursor, activity }` — steer receipts in submission order plus the Session's `activity`. Without `includeCompleted`, `data` lists only pending and `uncertain` receipts. Poll without `cursor` to see changes; `cursor` only pages. |
| `stop({ agentId, sessionId, turnId })` | `POST /v1/agents/{agentId}/sessions/{sessionId}/stop` | `{ stoppedTurnId, activity }` as soon as the stop is recorded, not after the Turn ends. Keep reading the existing stream until it settles. An unknown `turnId` returns `not_found`; a settled Turn's ID never stops a later Turn. |

Fork eligibility, retries, child contents, and error codes are in [Add a requested fork](recipes/chat-in-your-app.md#add-a-requested-fork).

A `SessionInput` is a steer receipt: `requestId`, `sequence`, `message`, `state` (`accepted`, `delivered`, `committed`, `not_placed`, or `uncertain`), the `turnId` it was bound to, `reason` (`stopped`, `failed`, `owner_lost`, `turn_finished`, or `null`), and timestamps. `activity` is `{ state, turnId }` with `state` one of `idle`, `running`, `stopping`, `approval`. What each receipt state means, the `data-ba-steer-consumed` stream chunk, and the client-held queue are in [Add chat to your app](recipes/chat-in-your-app.md).

### `client.tasks` (Tasks and Task runs)

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `create(body)` | `POST /v1/tasks` | `{ task, runId }`. `runId` is set for `submit: true`; pass `idempotencyKey` on create to retry the same Task and initial run safely. |
| `list({ agentId?, userId?, cursor?, limit? })` | `GET /v1/tasks` | Page of Tasks |
| `get({ taskId })` | `GET /v1/tasks/{taskId}` | `TaskResponse` |
| `update({ taskId, ...body })` | `PATCH /v1/tasks/{taskId}` | `TaskResponse` |
| `delete({ taskId })` | `DELETE /v1/tasks/{taskId}` | `void` |
| `createRun({ taskId, idempotencyKey? })` | `POST /v1/tasks/{taskId}/runs` | `{ runId }` |
| `listRuns({ taskId, cursor?, limit? })` | `GET /v1/tasks/{taskId}/runs` | Page of Task runs |
| `getRun({ taskId, runId })` | `GET /v1/tasks/{taskId}/runs/{runId}` | `TaskRunResponse` |
| `runMessages({ taskId, runId, cursor?, after?, limit? })` | `GET /v1/tasks/{taskId}/runs/{runId}/messages` | Transcript page plus run `status`, `error`, `finishedAt` for polling. |
| `cancelRun({ taskId, runId })` | `POST /v1/tasks/{taskId}/runs/{runId}/cancel` | `void` |

### `client.workspaces`

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `create(body?)` | `POST /v1/workspaces` | `Workspace` |
| `list({ userId?, cursor?, limit? })` | `GET /v1/workspaces` | Page of `Workspace` |
| `get({ workspaceId })` | `GET /v1/workspaces/{workspaceId}` | `Workspace` |
| `update({ workspaceId, ...body })` | `PUT /v1/workspaces/{workspaceId}` | `Workspace` |
| `delete({ workspaceId })` | `DELETE /v1/workspaces/{workspaceId}` | `"completed"` or `"pending"` |

### `client.artifacts`

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `list({ agentId?, sessionId?, cursor? })` | `GET /v1/artifacts` | Page of `ArtifactListItem` |
| `get({ artifactId })` | `GET /v1/artifacts/{artifactId}` | `ArtifactListItem` |
| `createDownloadUrl({ artifactId })` | `POST /v1/artifacts/{artifactId}/download-url` | `{ url, expiresAt }` |
| `delete({ artifactId })` | `DELETE /v1/artifacts/{artifactId}` | `void` |

### `client.memories`

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `list({ agentId, search?, userId?, cursor?, limit? })` | `GET /v1/agents/{agentId}/memories` | Page of Memories |
| `create({ agentId, ...body })` | `POST /v1/agents/{agentId}/memories` | `MemoryResponse` |
| `get({ agentId, memoryId })` | `GET /v1/agents/{agentId}/memories/{memoryId}` | `MemoryResponse` |
| `update({ agentId, memoryId, ...body })` | `PATCH /v1/agents/{agentId}/memories/{memoryId}` | `MemoryResponse` |
| `delete({ agentId, memoryId })` | `DELETE /v1/agents/{agentId}/memories/{memoryId}` | `void` |

### `client.mcpConnections`

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `create(body)` | `POST /v1/mcp-connections` | `McpConnectionResponse` |
| `list()` | `GET /v1/mcp-connections` | `{ mcpConnections }`. Not paginated. |
| `get({ mcpConnectionId })` | `GET /v1/mcp-connections/{mcpConnectionId}` | `McpConnectionResponse` |
| `update({ mcpConnectionId, ...body })` | `PATCH /v1/mcp-connections/{mcpConnectionId}` | `McpConnectionResponse` |
| `delete({ mcpConnectionId })` | `DELETE /v1/mcp-connections/{mcpConnectionId}` | `void` |
| `test({ mcpConnectionId })` | `POST /v1/mcp-connections/{mcpConnectionId}/test` | `McpConnectionTestResponse`, discriminated on `ok`. |
| `connect({ mcpConnectionId })` | `POST /v1/mcp-connections/{mcpConnectionId}/connect` | `McpConnectionOauthConnectResponse`. Starts OAuth. |
| `reconnect({ mcpConnectionId, ...body })` | `POST /v1/mcp-connections/{mcpConnectionId}/reconnect` | `McpConnectionReconnectResult`. Replaces credentials. |

### `client.chatConnections` (Slack and Telegram)

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `create(body)` | `POST /v1/chat-connections` | `ChatConnection` |
| `list()` | `GET /v1/chat-connections` | `{ chatConnections }`. Not paginated. |
| `get({ chatConnectionId })` | `GET /v1/chat-connections/{chatConnectionId}` | `ChatConnection` |
| `update({ chatConnectionId, ...body })` | `PATCH /v1/chat-connections/{chatConnectionId}` | `ChatConnection` |
| `rotateCredentials({ chatConnectionId, ...body })` | `POST /v1/chat-connections/{chatConnectionId}/credentials` | `ChatConnection` |
| `checkHealth({ chatConnectionId })` | `POST /v1/chat-connections/{chatConnectionId}/health` | `ChatConnection` |
| `enable({ chatConnectionId })` | `POST /v1/chat-connections/{chatConnectionId}/enable` | `ChatConnection` |
| `disable({ chatConnectionId })` | `POST /v1/chat-connections/{chatConnectionId}/disable` | `ChatConnection` |
| `delete({ chatConnectionId })` | `DELETE /v1/chat-connections/{chatConnectionId}` | `void` |

### `client.chatDeliveries`

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `list({ status?, since?, cursor?, limit? })` | `GET /v1/chat-deliveries` | Page of `TenantChatDelivery`. Failed and ambiguous deliveries across every connection, newest first (an attention feed, not full history). `status` is an array of `failed` and/or `ambiguous` (default both); pending/confirmed are rejected. One connection's full deliveries list and repair are REST-only, not in the SDK: `GET /v1/chat-connections/{id}/deliveries` and `POST /v1/chat-connections/{id}/deliveries/{deliveryId}/repair`. `since` is an inclusive ISO 8601 lower bound. |

### `client.agent({ agentId }).skills`

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `list({ cursor?, limit? })` | `GET /v1/agents/{agentId}/skills` | Page of `Skill` |
| `create(body)` | `POST /v1/agents/{agentId}/skills` | `SkillDetail` |
| `upload({ source: { file, type } })` | `POST /v1/agents/{agentId}/skills/upload` | `SkillDetail`. `type` is `"zip"`, `"tar"`, or `"tar.gz"`. |
| `get({ skillId })` | `GET /v1/agents/{agentId}/skills/{skillId}` | `SkillDetail` |
| `delete({ skillId })` | `DELETE /v1/agents/{agentId}/skills/{skillId}` | `void` |
| `getFile({ skillId, path })` | `GET /v1/agents/{agentId}/skills/{skillId}/files?path=` | `Uint8Array` |
| `putFile({ skillId, path, content })` | `PUT /v1/agents/{agentId}/skills/{skillId}/files?path=` | `SkillDetail`. `content` is `string`, `Blob`, or `Uint8Array`. |
| `deleteFile({ skillId, path })` | `DELETE /v1/agents/{agentId}/skills/{skillId}/files?path=` | `SkillDetail` |
| `copy({ skillId, to: { agentIds } })` | `POST /v1/agents/{agentId}/skills/{skillId}/copies` | `SkillCopyResults`, one result per target Agent. |

### `client.tenant`

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `get()` | `GET /v1/tenant` | `TenantSettingsResponse` |
| `patch(body)` | `PATCH /v1/tenant` | `TenantSettingsResponse` |

### `client.usage`

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `get({ from?, to?, agentId?, sessionId?, userId?, groupBy?, limit? })` | `GET /v1/usage` | `UsageResponse`. `groupBy` is `day` (default), `agent`, `model`, `session`, or `user`. Dates are `YYYY-MM-DD`. |
| `getForAgent({ agentId, ...query })` | `GET /v1/agents/{agentId}/usage` | `UsageResponse` |
| `overview({ from?, to?, limit? })` | `GET /v1/usage/overview` | `UsageOverviewResponse`: totals, daily usage, and top Agents, users, and models. |
| `sessions({ sessionIds, from?, to? })` | `POST /v1/usage/sessions` | `{ data: { sessionId, totals }[] }`. Supply 1 to 100 distinct Session IDs; dates are `YYYY-MM-DD`. |

### Merchant billing

These bill your own customers through your Polar or Dodo account.

| Method | HTTP | Returns / notes |
| --- | --- | --- |
| `merchantConnection.create(body)` | `POST /v1/merchant-connection` | `MerchantConnectionResponse`. One per Tenant. |
| `merchantConnection.get()` | `GET /v1/merchant-connection` | `MerchantConnectionResponse` |
| `merchantConnection.update(body)` | `PATCH /v1/merchant-connection` | `MerchantConnectionResponse` |
| `merchantConnection.retire()` | `DELETE /v1/merchant-connection` | `void`. Deliveries stop. |
| `merchantBindings.list({ userId?, cursor?, limit? })` | `GET /v1/merchant-connection/bindings` | `{ bindings, nextCursor }` |
| `merchantBindings.put({ userId, ...body })` | `PUT /v1/merchant-connection/bindings/{userId}` | `MerchantBindingResponse` |
| `merchantBindings.delete({ userId })` | `DELETE /v1/merchant-connection/bindings/{userId}` | `void` |
| `merchantUsageEvents.list({ status?, cursor?, limit? })` | `GET /v1/merchant-usage-events` | `{ events, nextCursor }` |
| `merchantUsageEvents.get({ eventId })` | `GET /v1/merchant-usage-events/{eventId}` | `MerchantUsageEventResponse` |
| `merchantUsageEvents.summary({ days? })` | `GET /v1/merchant-usage-events/summary` | `MerchantUsageSummaryResponse` |
| `merchantUsageEvents.retry({ eventId })` | `POST /v1/merchant-usage-events/{eventId}/retry` | `MerchantUsageEventResponse` |
| `merchantUsageEvents.release({ eventId })` | `POST /v1/merchant-usage-events/{eventId}/release` | `MerchantUsageEventResponse` |
| `merchantUsageEvents.discard({ eventId })` | `POST /v1/merchant-usage-events/{eventId}/discard` | `MerchantUsageEventResponse` |

## Pagination

Paginated lists return `{ data, nextCursor }`. `nextCursor` is an opaque string,
or `null` on the last page. Pass it back as `cursor` with the same filters. The
SDK does not auto-paginate.

Provider, MCP Connection, and Chat Connection lists return named arrays and are
not paginated. Agent and Prompt lists use `{ data, nextCursor }` too. Merchant
binding and usage-event lists page with named arrays: `{ bindings, nextCursor }`
and `{ events, nextCursor }`.

```ts
import type { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;

export async function allSessionIds(
  agentId: string,
  userId: string
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.sessions.list({
      agentId,
      userId,
      limit: 100,
      cursor,
    });
    ids.push(...page.data.map((session) => session.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return ids;
}
```

Transcripts (`sessions.messages`, `tasks.runMessages`) return the newest page
first, with messages in chronological order inside each page, and also carry
`latestCursor`. To watch a transcript grow, pass
`latestCursor` back as `after` on the next poll. `after` returns only messages
added later. A tool approval decision and its continuation update the assistant
message in place, at the same position, possibly over several rounds. While any
loaded message has a tool part in state `approval-requested` or
`approval-responded`, poll the newest page without `after` and replace messages
by ID; go back to `after` once none remain.
`sessions.messages().data` already contains AI SDK `UIMessage` values; use
these as `useChat` initial messages without an extra conversion method.

## Handle errors

Every failure the SDK raises is a `BlazingAgentsError`. Check it with
`BlazingAgentsError.isInstance(error)`, which also works across duplicated
package copies, then switch on `code`.

| Field | Meaning |
| --- | --- |
| `code` | Stable string to branch on, for example `not_found`, `validation_failed`, `rate_limited`, `session_busy`. Unknown future codes still arrive as strings. |
| `message` | Human-readable text, prefixed with `[code]`. Do not parse it. |
| `status` | HTTP status. Absent for `network_error` and `request_aborted`. |
| `param` | The offending field, when the server names one. |
| `details` | Extra structured data, for example validation issues. |
| `requestId` | BA's `x-request-id`. Log it. |
| `headers` | Response headers. |
| `responseBody`, `responseBodyTruncated` | Raw body (up to 64 KiB) when the response was not a valid error envelope. |
| `cause` | The underlying error, when there is one. |

SDK-local codes:

| Code | When |
| --- | --- |
| `network_error` | `fetch` threw before any HTTP response. |
| `request_aborted` | Your `abortSignal` fired. |
| `invalid_response` | The server response did not match the expected shape. |
| `stream_error` | A stream failed mid-way, or you claimed a result body twice. |

```ts
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";

declare const client: BlazingAgents;

export async function findAgentName(agentId: string): Promise<string | null> {
  try {
    const agent = await client.agents.get({ agentId });
    return agent.name;
  } catch (error) {
    if (!BlazingAgentsError.isInstance(error)) {
      throw error;
    }
    if (error.code === "not_found") {
      return null;
    }
    console.error(error.code, error.status, error.requestId, error.message);
    throw error;
  }
}
```

Errors before streaming starts reject the `chat`, `completion`, or `object`
promise. After streaming starts, a failed chat Turn ends its stream with an
`{ type: "error", errorText }` event, which `useChat` already understands. For
`completion` and `object`, the stream throws and awaiting `text` or `object`
rejects with `stream_error`.

## Connect `useChat` through your backend

The browser never holds the Tenant key. It talks to your backend, and your
backend calls BA. `BlazingAgentsChatTransport` is an AI SDK `ChatTransport` for
`useChat` that posts `{ message, messageId, sessionId, trigger }` to your
endpoint. After the first reply it reads the new Session ID from the `Location`
header and sends it on every later message.

Options are AI SDK `HttpChatTransportInitOptions` (`api`, `headers`,
`credentials`, `body`, `fetch`) plus:

- `sessionId`: an existing `ss_` ID to resume after a reload.
- `onSessionId(id)`: called once when a new Session is created. Persist the ID.

```tsx
"use client";

import { useChat } from "@ai-sdk/react";
import { BlazingAgentsChatTransport } from "@blazingagents/sdk";
import { useState } from "react";

export function Chat({ initialSessionId }: { initialSessionId?: string }) {
  const [input, setInput] = useState("");
  // Create the transport once. It keeps the Session ID itself after the first reply.
  const [transport] = useState(
    () =>
      new BlazingAgentsChatTransport({
        api: "/api/chat",
        sessionId: initialSessionId,
        onSessionId: (id) => localStorage.setItem("chat-session", id),
      })
  );
  const { messages, sendMessage, status } = useChat({ transport });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void sendMessage({ text: input });
        setInput("");
      }}
    >
      {messages.map((message) => (
        <p key={message.id}>
          {message.role}:{" "}
          {message.parts.map((part) => (part.type === "text" ? part.text : ""))}
        </p>
      ))}
      <input value={input} onChange={(event) => setInput(event.target.value)} />
      <button type="submit" disabled={status !== "ready"}>
        Send
      </button>
    </form>
  );
}
```

On the backend, `createChatRelay` builds a `(request: Request) => Promise<Response>`
handler that matches this transport. It validates the body, checks that the
caller owns the Session through your `SessionOwnershipStore`, calls
`client.chat`, records the owner of new Sessions, and returns the stream or a
JSON error. `createCompletionRelay` does the same for `{ prompt }` bodies.

```ts
import {
  BlazingAgents,
  createChatRelay,
  type RelayContext,
  type SessionOwnershipStore,
} from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const sessions: SessionOwnershipStore;
declare function userIdFromRequest(request: Request): Promise<string | null>;

async function resolveContext(request: Request): Promise<RelayContext | null> {
  const userId = await userIdFromRequest(request);
  return userId === null ? null : { agentId: "ag_0123456789abcdef", userId };
}

export const POST = createChatRelay({ client, resolveContext, sessions });
```

`resolveContext` returns `null` for unauthenticated requests, which become 401.
`RelayContext` also accepts `metadata` and request-local `functions`. `SessionOwnershipStore`
needs `ownerOf(sessionId)` and `recordOwner(sessionId, userId)` backed by your
database.

For a native app that holds its own server-issued credentials and calls the SDK
directly, `BlazingAgentsDirectChatTransport({ getClient, agentId, sessionId?,
onSessionId?, functions? })` drives `useChat` through `client.chat()` without a
relay. It also has `sendUserMessages({ messages, abortSignal? })`, which sends
an explicit ordered batch as one ordinary Turn on the transport's Session —
use it for the messages your client held while the Session was busy.

## Gotchas

- Passing a string to `client.agent("ag_...")` fails to type-check. Use
  `client.agent({ agentId })`.
- Calling `toResponse()` after `toStream()` (or twice) throws `stream_error`.
  Pick one accessor per result.
- A Session saves its Agent configuration at the first Turn. Read it with
  `client.sessions.get({ agentId, sessionId })`.
- `agents.delete` requires `includeArtifacts` and `sessions.delete` requires
  `deleteArtifacts`. Decide explicitly whether published files go too.
- Forgetting `userId` records every Turn at Tenant level, so per-user usage is
  lost. Pass your end user's ID on every generation call.
- `object` results are `unknown`. Validate before use.
- The chat transport does not resume an interrupted stream; `reconnectToStream`
  returns `null`. Reload history before resending.
- `chat` on a busy Session fails with `session_busy`. Steer the running Turn
  with `sessions.submitInput()`, or keep the message in your own queue and send
  it as ordinary chat once the Turn settles.
- Agent and Prompt names can repeat. Read every page before resolving a name
  to an ID; reject multiple exact matches.

## Go deeper

- [TypeScript SDK](https://docs.blazingagents.com/sdk/typescript)
- [Client](https://docs.blazingagents.com/sdk/typescript/client)
- [Sessions](https://docs.blazingagents.com/sdk/typescript/sessions)
- [Tasks](https://docs.blazingagents.com/sdk/typescript/tasks)
- [Errors](https://docs.blazingagents.com/api-reference/protocols/errors)
- [Pagination and filtering](https://docs.blazingagents.com/api-reference/protocols/pagination-and-filtering)
- [Next.js example](https://github.com/blazingagents/examples/tree/main/nextjs-ai-sdk)
- [Cloudflare Worker relay example](https://github.com/blazingagents/examples/tree/main/cloudflare-worker-relay)
