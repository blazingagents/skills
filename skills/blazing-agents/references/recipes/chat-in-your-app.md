# Add chat to your app

You will have a streaming chat UI in your web app. Each signed-in user gets their own conversations, can reopen them with history, and can stop, resend, and regenerate answers.

## When to use this

Your users chat with an Agent inside your own web product, and conversations must survive page reloads. If you instead want the Agent inside Slack or Telegram, read [Slack and Telegram](slack-and-telegram.md). If you want one-shot text with no conversation, use `client.completion()` from [the TypeScript SDK reference](../sdk-typescript.md).

## How it works

Your browser talks only to your backend. The backend authenticates the user and calls BA through `client.forUser(verifiedUserId)`. BA checks that the Agent and Session belong to that user. BA stores the history, so each request carries only the newest message and the Session ID. The first response returns a new Session ID in `Location`. AI SDK `useChat` and `BlazingAgentsChatTransport` render the stream and keep that ID for later messages.

## Build it

1. Install the packages. Your backend needs `@blazingagents/sdk` (or `blazing-agents` for Python). Your React frontend needs `@blazingagents/sdk`, `ai`, and `@ai-sdk/react`.

```bash
npm install @blazingagents/sdk ai @ai-sdk/react zod
# Python backend instead:
pip install blazing-agents fastapi uvicorn
```

Use the updated SDK and server described in [the SDK reference](../sdk-typescript.md). The published package may not yet contain these APIs.

2. Add the backend. `chat` relays one Turn and `history` returns a Session's saved messages. Mount them as `POST /api/chat` and `GET /api/chat/history` in your framework. In the Next.js App Router, export them as `POST` and `GET` handlers. In Hono, call `chat(c.req.raw)`. Authenticate the user, select their Agent in backend code, validate the request body, then call the scoped client. `sessions.messages()` returns the native UIMessage page. Return its cursors with the messages for older-history controls.

```ts
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";
import { safeValidateUIMessages } from "ai";
import { z } from "zod";

declare function authenticate(request: Request): Promise<{ id: string; agentId: string } | null>;
const tenant = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });
const chatBody = z.object({
  message: z.unknown(),
  messageId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  trigger: z.enum(["submit-message", "regenerate-message"]).default("submit-message"),
});

export async function chat(request: Request): Promise<Response> {
  const user = await authenticate(request);
  if (!user) return new Response("Sign in first.", { status: 401 });
  try {
    const body = chatBody.parse(await request.json());
    const messages = await safeValidateUIMessages({ messages: [body.message] });
    if (!messages.success || messages.data[0].role !== "user") {
      return new Response("Invalid message.", { status: 400 });
    }
    const client = tenant.forUser(user.id);
    const input = {
      agentId: user.agentId,
      message: messages.data[0],
      messageId: body.messageId,
      abortSignal: request.signal,
    };
    const result = await client.chat(body.sessionId
      ? { ...input, sessionId: body.sessionId, trigger: body.trigger }
      : { ...input, trigger: "submit-message" });
    return result.toResponse();
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return new Response("Invalid request.", { status: 400 });
    }
    if (BlazingAgentsError.isInstance(error)) {
      return Response.json({ error: { code: error.code } }, { status: error.status ?? 502 });
    }
    throw error;
  }
}

export async function history(request: Request): Promise<Response> {
  const user = await authenticate(request);
  if (!user) return new Response("Sign in first.", { status: 401 });
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId");
  if (!sessionId) return new Response("Missing Session ID.", { status: 400 });
  try {
    const page = await tenant.forUser(user.id).sessions.messages({
      agentId: user.agentId,
      sessionId,
      cursor: params.get("cursor") ?? undefined,
      limit: 200,
      abortSignal: request.signal,
    });
    return Response.json({ messages: page.data, nextCursor: page.nextCursor });
  } catch (error) {
    if (BlazingAgentsError.isInstance(error)) {
      return Response.json({ error: { code: error.code } }, { status: error.status ?? 502 });
    }
    throw error;
  }
}
```

The authentication hook returns the verified user's ID and their Agent ID from trusted backend state. Provision that Agent with the same user scope. `createChatRelay` remains an alternative for integrations that maintain their own `SessionOwnershipStore`; it does not select a scoped client automatically.

The Python SDK accepts the verified scope in `extra_headers` on every call. The SDK returns the raw stream bytes; relay them unchanged and copy the `Location` header on the first Turn so the frontend learns the Session ID.

```python
from typing import Any, Literal, TypedDict

from blazing_agents import APIStatusError, AsyncBlazingAgents, BlazingAgentsError
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

client = AsyncBlazingAgents()  # reads BLAZING_AGENTS_API_KEY
app = FastAPI()


def current_user(request: Request) -> str:
    """Your sign-in check. Return your user's ID or raise HTTPException(401)."""
    raise NotImplementedError


def agent_for_user(user_id: str) -> str:
    """Read this user's Agent ID from trusted backend state."""
    raise NotImplementedError


class HistoryPagination(TypedDict, total=False):
    cursor: str


class ChatBody(BaseModel):
    message: dict[str, object]
    messageId: str | None = None
    sessionId: str | None = None
    trigger: Literal["submit-message", "regenerate-message"] = "submit-message"


@app.post("/api/chat")
async def chat(body: ChatBody, user_id: str = Depends(current_user)):
    if body.message.get("role") != "user":
        raise HTTPException(400, "Invalid message.")
    headers = {"cache-control": "no-cache", "x-vercel-ai-ui-message-stream": "v1"}
    extra: dict[str, Any] = {"extra_headers": {"X-BA-User-Id": user_id}}
    if body.messageId:
        extra["message_id"] = body.messageId
    try:
        if body.sessionId is None:
            stream = await client.chat(
                agent_id=agent_for_user(user_id), message=body.message, user_id=user_id, **extra
            )
            headers["location"] = stream.headers["location"]
        else:
            stream = await client.chat(
                agent_id=agent_for_user(user_id),
                session_id=body.sessionId,
                message=body.message,
                trigger=body.trigger,
                user_id=user_id,
                **extra,
            )
    except APIStatusError as exc:
        error = {"code": exc.code, "message": str(exc)}
        return JSONResponse({"error": error}, status_code=exc.status_code)
    except BlazingAgentsError:
        error = {"code": "upstream_error", "message": "Request failed."}
        return JSONResponse({"error": error}, status_code=502)
    return StreamingResponse(
        stream,
        status_code=stream.status_code,
        media_type="text/event-stream",
        headers=headers,
    )


@app.get("/api/chat/history")
async def history(
    session_id: str = Query(alias="sessionId"),
    cursor: str | None = Query(default=None),
    user_id: str = Depends(current_user),
):
    pagination: HistoryPagination = {"cursor": cursor} if cursor is not None else {}
    try:
        page = await client.sessions.messages(
            agent_id=agent_for_user(user_id), session_id=session_id, limit=200,
            extra_headers={"X-BA-User-Id": user_id},
            **pagination,
        )
    except APIStatusError as exc:
        raise HTTPException(exc.status_code, detail={"code": exc.code}) from exc
    return {
        "messages": [
            m.model_dump(mode="json", by_alias=True, exclude_unset=True)
            for m in page.data
        ],
        "nextCursor": page.next_cursor
    }
```

3. Add the React chat. `ChatPage` loads saved history for the stored Session, then mounts `Chat`. `Chat` keeps a copy of the last successful conversation and restores it after an error or Stop, leaving the typed text in the box for an edited or unchanged resend.

```tsx
import { useChat } from "@ai-sdk/react";
import { BlazingAgentsChatTransport } from "@blazingagents/sdk";
import { generateId, type UIMessage } from "ai";
import { type FormEvent, useEffect, useRef, useState } from "react";

interface Conversation {
  key: string;
  sessionId?: string;
  messages: UIMessage[];
}

export function ChatPage({ userId, token }: { userId: string; token: string }) {
  return <UserChatPage key={`${userId}:${token}`} userId={userId} token={token} />;
}

function UserChatPage({ userId, token }: { userId: string; token: string }) {
  const storageKey = `chat-session:${userId}`;
  const [conversation, setConversation] = useState<Conversation>();

  useEffect(() => {
    const sessionId = localStorage.getItem(storageKey);
    if (!sessionId) return setConversation({ key: generateId(), messages: [] });
    const controller = new AbortController();
    void fetch(`/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        localStorage.removeItem(storageKey);
        return setConversation({ key: generateId(), messages: [] });
      }
      const body: { messages: UIMessage[] } = await response.json();
      if (controller.signal.aborted) return;
      setConversation({ key: generateId(), sessionId, messages: body.messages });
    }).catch(() => {
      if (!controller.signal.aborted) setConversation({ key: generateId(), messages: [] });
    });
    return () => controller.abort();
  }, [token, storageKey]);

  if (!conversation) return <p>Loading...</p>;
  return (
    <Chat
      key={conversation.key}
      token={token}
      storageKey={storageKey}
      conversation={conversation}
      onNewConversation={() => {
        localStorage.removeItem(storageKey);
        setConversation({ key: generateId(), messages: [] });
      }}
    />
  );
}

function Chat({
  token,
  storageKey,
  conversation,
  onNewConversation,
}: {
  token: string;
  storageKey: string;
  conversation: Conversation;
  onNewConversation: () => void;
}) {
  const [input, setInput] = useState("");
  const saved = useRef(conversation.messages);
  const sending = useRef(false);
  const regenerating = useRef(false);
  const [transport] = useState(
    () =>
      new BlazingAgentsChatTransport({
        api: "/api/chat",
        headers: { authorization: `Bearer ${token}` },
        sessionId: conversation.sessionId,
        onSessionId: (id) => localStorage.setItem(storageKey, id),
      }),
  );
  const chat = useChat({
    transport,
    messages: conversation.messages,
    onError() {
      sending.current = false;
      chat.setMessages(saved.current);
    },
    onFinish({ messages, finishReason, isAbort, isError, isDisconnect }) {
      sending.current = false;
      if (isAbort || isError || isDisconnect || !finishReason || finishReason === "error") {
        chat.setMessages(saved.current);
        return;
      }
      saved.current = messages;
      if (!regenerating.current) setInput("");
    },
  });
  const stopOnUnmount = useRef(chat.stop);
  stopOnUnmount.current = chat.stop;
  useEffect(() => () => { void stopOnUnmount.current(); }, []);
  const busy = chat.status === "submitted" || chat.status === "streaming";
  const hasAnswer = chat.messages.some((message) => message.role === "assistant");

  function send(event: FormEvent) {
    event.preventDefault();
    if (sending.current || !input.trim()) return;
    sending.current = true;
    regenerating.current = false;
    chat.clearError();
    void chat.sendMessage({ id: generateId(), role: "user", parts: [{ type: "text", text: input }] });
  }

  async function stop() {
    await chat.stop();
    sending.current = false;
    chat.setMessages(saved.current);
  }

  function regenerate() {
    if (sending.current || !hasAnswer) return;
    sending.current = true;
    regenerating.current = true;
    chat.clearError();
    void chat.regenerate();
  }

  return (
    <main>
      {chat.messages.map((message) => (
        <p key={message.id}>
          <strong>{message.role}:</strong>{" "}
          {message.parts.map((part) => (part.type === "text" ? part.text : "")).join("")}
        </p>
      ))}
      <form onSubmit={send}>
        <input aria-label="Message" value={input} disabled={busy} onChange={(event) => setInput(event.target.value)} />
        <button type="submit" disabled={busy || !input.trim()}>Send</button>
        <button type="button" onClick={stop} disabled={!busy}>Stop</button>
        <button type="button" onClick={regenerate} disabled={busy || !hasAnswer}>Regenerate</button>
        <button type="button" onClick={onNewConversation} disabled={busy}>New conversation</button>
      </form>
      {chat.error && <p role="alert">{chat.error.message}</p>}
    </main>
  );
}
```

## Gotchas

- **History lives in BA.** Send only the newest user message. The transport already does this; a custom client that posts the whole `messages` array gets a 400 from your `chat` handler.
- **Derive scope from verified sign-in.** BA enforces ownership when you use `forUser()`. A body `userId` alone grants no access.
- **Save the Session ID.** The transport receives it before the answer streams. Keep it even when the first Turn fails or is stopped; the Session exists and is simply empty.
- **Keep one transport per conversation.** `useChat` ignores a new transport after mount. To switch Session or user, remount `Chat` with a new `key`, as `ChatPage` does. Clear persisted user data on sign-out and abort requests from the old account.
- **Resend is a new attempt.** Give every send a fresh message ID; message IDs are not idempotency keys. A failed or stopped Turn adds nothing to history, so the edited or unchanged text is simply sent again.
- **Tool effects can repeat.** Stop cancels the Turn but cannot undo a Tool call that already ran, and a resend can run it again (for example, a second email). Make side-effecting Tools safe to repeat or gate them with [human approval](human-approval.md).
- **A lost response may already be saved.** A dropped connection is not proof of failure. Reload history before telling the user their message was lost.
- **Regenerate only after a successful answer.** A prompt that failed was never saved, so there is nothing to regenerate. If regeneration fails or is stopped, the old answer stays.
- **`session_busy` (HTTP 409)** means a Tool approval is pending, an approved call is still running, or another Turn holds the Session. Show the error and let the user send again later.
- **Older history.** `sessions.messages` returns the newest page, oldest first. Pass `nextCursor` back as `cursor` to load earlier pages for long conversations. Prepend each older page without reversing its messages.
- **Proxies must not buffer the stream.** `toResponse()` sets `cache-control: no-cache`; make sure every proxy in front of your backend passes chunks through as they arrive.

## Check it works

- Send "Remember the word cobalt.", then "Which word did I ask you to remember?". The second answer says cobalt.
- Reload the page. The earlier messages appear in chronological order, and the next message continues the same conversation. Load an older page and verify that order again.
- Switch accounts while history loads or a reply streams. The new account shows only its own conversation.
- Call `POST /api/chat` without your sign-in, and you get 401. Call it as a second user with the first user's Session ID, and BA returns 404.
- Press Stop mid-answer. The partial answer disappears, your text stays in the box, and Send works again.
- Press Regenerate. The last answer is replaced, and after a reload the new answer is the saved one.
- Usage filtered by your user's ID includes these Turns. See [usage dashboards](usage-dashboards.md).

## Go deeper

- [Connect Blazing Agents to your app](https://docs.blazingagents.com/getting-started/connect-your-app)
- [Build a chatbot](https://docs.blazingagents.com/getting-started/chatbot)
- [Sessions and turns](https://docs.blazingagents.com/platform/sessions-and-turns)
- [TypeScript `client.sessions`](https://docs.blazingagents.com/sdk/typescript/sessions)
- [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals)
- [Serving many users](multi-user-apps.md)
- Examples: [Next.js](https://github.com/blazingagents/examples/tree/main/nextjs-ai-sdk), [Vite + Hono](https://github.com/blazingagents/examples/tree/main/vite-hono-ai-sdk), [Vite + FastAPI](https://github.com/blazingagents/examples/tree/main/vite-fastapi-ai-sdk)
