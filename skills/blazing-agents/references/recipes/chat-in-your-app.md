# Add chat to your app

You will have a streaming chat UI in your React app. Each signed-in user gets their own conversation, which comes back after a page reload. While the Agent answers, users can keep typing, and a message they send then steers the running Turn.

## When to use this

Your users chat with an Agent inside your own web product, and conversations must survive page reloads. If you instead want the Agent inside Slack or Telegram, read [Slack and Telegram](slack-and-telegram.md). If you want one-shot text with no conversation, use `client.completion()` from [the TypeScript SDK reference](../sdk-typescript.md).

## How it works

Your browser talks only to your backend, through one endpoint that `createChatRelay` serves. Each request is a JSON `POST` whose `op` names the operation: `chat` streams a Turn, `history` returns one page of the Session's stored messages, and `steer` sends a user message into the Turn running now. For each request the relay calls your `resolveContext`, which returns the signed-in user and their Agent. The relay then sends every API request through `client.forUser(userId)`, so BA answers `404` for another user's Session or Agent. BA stores the history, so a chat request carries only the newest message and the Session ID. The first reply names the new Session in its `Location` header.

`useBlazingAgentsChat` from `@blazingagents/sdk/react` is the browser side. It keeps the Session ID in `localStorage`, reads the stored transcript back after a reload, and turns the AI SDK UI message stream into `messages`. `send()` starts a Turn when the chat is idle and steers the running Turn while a reply streams. BA holds no queue. A message that can do neither, such as one sent while a Tool approval waits, stays in the hook and goes out as the next Turn. Stop aborts the chat request, which cancels the Turn.

## Build it

For a Python, Rust, or Go backend, read the relay code for step 2 in [Python](chat-in-your-app.python.md), [Rust](chat-in-your-app.rust.md), [Go](chat-in-your-app.go.md). Step 3 is the same React code for every backend.

1. Install the packages. Your backend needs `@blazingagents/sdk`, `ai`, and `zod`. Your React frontend also needs `react` and `@ai-sdk/react`, which only `@blazingagents/sdk/react` loads.

```bash
npm install @blazingagents/sdk ai@^7 zod react @ai-sdk/react
```

2. Add the relay. `resolveContext` reads the user ID from your verified sign-in and returns `null` when there is none, which the relay answers with `401`. It also returns the user's Agent. The Agent and its Workspace must belong to the same user, so `agentFor` creates the Agent on that user's scoped client the first time. `BLAZING_AGENTS_PROVIDER_ID` is the Provider from [Getting started](../getting-started.md).

```ts
import { BlazingAgents, createChatRelay } from "@blazingagents/sdk";

declare function signedInUserId(request: Request): Promise<string | null>;

const client = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });
const providerId = process.env.BLAZING_AGENTS_PROVIDER_ID ?? "";

/** Each user gets their own Agent, and with it their own Workspace. */
async function agentFor(userId: string) {
  const user = client.forUser(userId);
  const [agent] = (await user.agents.list({ limit: 1 })).data;
  return agent ?? (await user.agents.create({ name: "Chat assistant", providerId, model: "openai/gpt-6-luna" }));
}

export const relayChat = createChatRelay({
  client,
  async resolveContext(request) {
    const userId = await signedInUserId(request);
    if (userId === null) return null;
    const agent = await agentFor(userId);
    return { agentId: agent.id, userId };
  },
});
```

Mount `relayChat` on one `POST` route. In Hono, that is `app.post("/api/chat", (c) => relayChat(c.req.raw))`. In the Next.js App Router, export it as `POST` from `app/api/chat/route.ts`. The relay never reads the user or the Agent from the request body.

3. Add the React chat. The hook posts to `/api/chat` unless you pass `api`.

```tsx
import { useBlazingAgentsChat } from "@blazingagents/sdk/react";
import { useState } from "react";

export function Chat() {
  const [text, setText] = useState("");
  const chat = useBlazingAgentsChat();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void chat.send(text);
        setText("");
      }}
    >
      {chat.messages.map((message) => (
        <p key={message.id}>
          {message.role}:{" "}
          {message.parts.map((part) => (part.type === "text" ? part.text : ""))}
        </p>
      ))}
      <input value={text} onChange={(event) => setText(event.target.value)} />
    </form>
  );
}
```

## What to add next

- **Put a failed message back.** `send()` resolves `true` once BA stores the message and `false` when the hook rolled it back: after an error, Stop, New Session, or a Turn that ended without storing it. It never rejects. On `false`, put the text back in the input so the user can resend it.
- **Stop.** `chat.stop()` aborts the chat request. The relay cancels the API request, which cancels the Turn, and the hook rolls back to the stored transcript. Disable the control unless `status` is `running`.
- **New conversation and regenerate.** `newSession()` cancels a running Turn, forgets the stored Session, and clears the transcript. `regenerate()` replaces the last assistant reply, and does nothing unless `canRegenerate` is true.
- **Errors.** `error` holds the last failed Turn, steer, or history read. The next `send()` clears it, and so does `clearError()`. A relay error response arrives as a `BlazingAgentsError` with the relay's `status` and `code`, such as `session_busy` (409) or `model_spending_limit_exceeded` (429). See [Troubleshooting](../troubleshooting.md) for each code.
- **Pending and running state.** `status` is `restoring`, `idle`, or `running`, and `send()` works in each. `pendingIds` holds the IDs in `messages` that are sent but not stored yet, so you can dim those messages. While `status` is `running`, a send steers, so label the button Steer.
- **Bearer-token sign-in.** Pass `headers`, such as ``{ authorization: `Bearer ${token}` }``. The hook reads them at request time. If the history read failed, a change to the header values reads it again, as when the user signs in after a reload.
- **One conversation per user in a shared browser.** Pass ``storageKey: `chat-session:${userId}` ``, and render the chat component with `key={userId}`, so a sign-in change mounts a fresh hook that reads that user's Session. `storageKey: null` keeps the Session in memory only.
- **Tool approvals.** A manual approval ends the reply with a Tool part in state `approval-requested`. Render it, then call `chat.addToolApprovalResponse({ id: part.approval.id, approved, reason })`. Once every approval of the round is answered, the hook sends the round and the continuation streams like any Turn. Messages sent while an approval waits go out after it. See [Human approval](human-approval.md).
- **Backend functions and attribution.** Return `functions` and `metadata` from `resolveContext`. The relay passes `functions` to each chat and approval continuation, and `metadata` to each chat. See [Backend functions](backend-functions.md).
- **A relay on another origin.** Expose the `Location` header through CORS, because the hook reads the new Session ID from it. For cookie sign-in, pass `credentials: "include"`.
- **A frontend without React.** `BlazingAgentsChatTransport` is the same browser side for an AI SDK `Chat` in another framework. It reads history and steers through the relay, and leaves waiting messages and rollback to your code. See [the TypeScript SDK reference](../sdk-typescript.md#chat-from-a-browser).

## Add a requested fork

The chat example ships no fork control. Add one only when the user asks to branch a conversation from a reply they chose.

1. Check eligibility on your backend. Offer the action only on assistant messages that `sessions.messages()` returns with `branchable: true`. Never judge eligibility from the live stream or rendered parts. A reply that is streaming or waiting on an approval is not branchable; earlier replies stay branchable while the source runs.
2. Save one idempotency key for the user's action, then fork on the signed-in user's scoped client: `client.forUser(userId).sessions.fork({ agentId, sessionId, messageId, idempotencyKey })` (Python: `client.for_user(user_id).sessions.fork(agent_id, session_id, message_id=..., idempotency_key=...)`; Rust: `client.for_user(&user_id)?.sessions().fork(agent_id, session_id, message_id, idempotency_key)`; Go: `scoped.Sessions.Fork(ctx, agentID, sessionID, ba.ForkSessionParams{MessageID: messageID, IdempotencyKey: key})` on the `*ba.UserClient`). After a lost response, retry with the same key and message. A retry returns the same child, even after the source is deleted. Never mint a new key for a retry.
3. Switch the chat to the child. Write the returned child Session ID to the hook's `storageKey` in `localStorage` (default `blazing-agents-session`), then remount the chat component with a new React `key`. The hook reads the stored Session ID when it mounts, loads the child's history, and sends the next message to the child.

The child is idle and holds history through the selected reply. Forking runs no model or Tool and records no usage. The child keeps the source's saved Agent configuration, `metadata`, and `userId`. It shares the Agent's Workspace files and Memories with the source, so a file change in one conversation shows in the other. Running Turns, pending approvals, and queued inputs are not copied. `forkedFrom` (`forked_from` in Python and Rust, `ForkedFrom` in Go) on the child names the source Session and message.

Handle these errors:

| Code | Meaning | Do |
| --- | --- | --- |
| `idempotency_conflict` (409) | A different message under the same key. | Restore the original selection. |
| `session_fork_unavailable` (409) | The selection was removed or is ineligible. | Reload history. |
| `session_fork_deleted` (410) | Replay of a child that was deleted. | Stop retrying. |
| `not_found` (404) | The source Session or Agent is missing or outside the user's scope. | Check the IDs and scope. |

## Gotchas

- **Derive scope from verified sign-in.** `resolveContext` returns the user ID from your sign-in check, never from the request. The relay ignores body keys it does not know, so the transport's `body` extras cannot change the user or the Agent.
- **The Agent must belong to the user.** `agentId` must name an Agent that `userId` owns, attached to a Workspace the same user owns. Otherwise the API answers `404`. An unscoped Agent shared by several users shares one Workspace, so one user's Turn can read another user's files.
- **Resend is a new attempt.** A failed or stopped Turn stores nothing, so a resend sends the text again under a new message ID. Stop cannot undo a Tool call that already ran, and a resend can run it again, such as a second email. Make side-effecting Tools safe to repeat, or gate them with [human approval](human-approval.md).
- **A steer the Turn did not read becomes the next message.** When the running Turn ends before it reads a steer, or BA refuses the steer with `steer_not_available`, the hook sends it as the next ordinary chat message with a new message ID. After the Turn finishes, a steered message shows where stored history places it. If the Turn read the steer and then failed, the resend can repeat Tool calls.
- **A steer sent just before Stop can land in the next Turn.** BA places a steer in the Turn that runs when the request arrives, so a Turn that starts while the steer is in flight stores it, even though `send()` already resolved `false`.
- **Steering stops at Tool approvals.** BA refuses steers while an approval waits, so the hook holds messages sent then until the continuation ends.
- **Two tabs can share one Session.** A send from the second tab while the first tab's Turn runs fails with `session_busy` (409), and `send()` resolves `false`.
- **A Turn that ended without `finish` keeps what it stored.** A Stop, an `error` chunk, a cut Turn (`turn_interrupted`), a mid-stream spending stop, or a dropped connection ends the stream without a `finish` chunk. The hook then reads history again. Each message sent for that Turn stays if history holds its ID, and rolls back if not. Never resend after a spending stop automatically. The user waits for the reset, or a Tenant admin changes the limit ([usage dashboards](usage-dashboards.md)).
- **`session_turn_unresponsive` (409)** means the Session's previous Turn stopped responding, so the Session is not free yet. It frees within a minute. Send again after that.
- **A Session the relay answers `404` for is forgotten.** The hook drops the stored Session ID and starts the next message on a new Session. That happens when the Session was deleted or belongs to another user.
- **Long histories load in pages.** On restore, the hook reads up to 50 pages of 200 messages, newest page first.
- **Server rendering is safe.** The hook reads `localStorage` after mount, and keeps the Session in memory where storage throws.
- **Proxies must not buffer the stream.** The relay sets `cache-control: no-cache`. Make sure every proxy in front of your backend passes chunks through as they arrive.

## Check it works

- Send "Remember the word cobalt.", then "Which word did I ask you to remember?". The second answer says cobalt.
- Reload the page. The earlier messages appear in chronological order, and the next message continues the same conversation.
- Call the relay without your sign-in, and you get `401`. As a second user, post `{ "op": "history", "sessionId": "<the first user's Session ID>" }`, and you get `404`.
- Sign in as another user in the same browser. The chat shows only that user's conversation.
- Press Stop mid-answer. The partial answer disappears, and `send()` for that message resolves `false`.
- While an answer streams, send a second message. The current answer takes it into account. After the Turn ends, the transcript shows the message once, and a reload shows the same order.
- If your UI answers Tool approvals, answer one. The continuation streams into the same assistant message.
- Press Regenerate. The last answer is replaced, and after a reload the new answer is the stored one.
- Usage filtered by your user's ID includes these Turns. See [usage dashboards](usage-dashboards.md).

### Check an added fork flow

- Select an older eligible assistant reply while the source streams a later Turn. The child includes the selected reply and starts idle, without new model/Tool execution or usage.
- Verify a streaming reply is ineligible, including when it is absent from saved history or its live chunks omit `branchable`. A persisted pending approval reply has `branchable: false`; do not offer it as a choice.
- Continue source and child independently, reload both, then fork an eligible inherited reply from the child.
- Lose the creation response and resend the same key and message. It returns the same child. Change the message under that key and verify `idempotency_conflict`.
- Delete the source after creation and replay the original request; it returns the child. Delete the child and replay; it returns `session_fork_deleted`.
- Try another user's source ID and get `not_found`. Confirm the child retains the source user scope.
- Change a Workspace file through one conversation and observe that current file in the other. Confirm the child's saved Agent configuration matches its source after an Agent edit.

## Go deeper

- [Connect Blazing Agents to your app](https://docs.blazingagents.com/getting-started/connect-your-app)
- [Build a chatbot](https://docs.blazingagents.com/getting-started/chatbot)
- [Sessions and turns](https://docs.blazingagents.com/platform/sessions-and-turns)
- [TypeScript `client.sessions`](https://docs.blazingagents.com/sdk/typescript/sessions)
- [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals)
- [Serving many users](multi-user-apps.md)
- Examples: [Next.js](https://github.com/blazingagents/examples/tree/main/nextjs-ai-sdk), [Vite + Hono](https://github.com/blazingagents/examples/tree/main/vite-hono-ai-sdk), [Vite + FastAPI](https://github.com/blazingagents/examples/tree/main/vite-fastapi-ai-sdk)
