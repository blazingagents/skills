# Add chat to your app

You will have a streaming chat UI in your web app. Each signed-in user gets their own conversations, can reopen them with history, and can stop, resend, and regenerate answers.

## When to use this

Your users chat with an Agent inside your own web product, and conversations must survive page reloads. If you instead want the Agent inside Slack or Telegram, read [Slack and Telegram](slack-and-telegram.md). If you want one-shot text with no conversation, use `client.completion()` from [the TypeScript SDK reference](../sdk-typescript.md).

## How it works

Your browser talks only to your backend. Your backend signs the user in, checks that they own the Session they ask for, and calls `client.chat()` with your Tenant API key. It passes your user's ID as `userId` so usage is attributed to them. BA stores the Session history, so each request carries only the newest user message plus the Session ID. The first response returns a new Session ID in its `Location` header; your backend records who owns it before relaying the stream. On the frontend, AI SDK `useChat` with `BlazingAgentsChatTransport` renders the stream and sends the Session ID back on every later message.

## Build it

1. Install the packages. Your backend needs `@blazingagents/sdk` (or `blazing-agents` for Python). Your React frontend needs `@blazingagents/sdk`, `ai`, and `@ai-sdk/react`.

```bash
npm install @blazingagents/sdk ai @ai-sdk/react zod
# Python backend instead:
pip install blazing-agents fastapi uvicorn
```

2. Add the backend. `chat` relays one Turn and `history` returns a Session's saved messages. Mount them as `POST /api/chat` and `GET /api/chat/history` in your framework. In the Next.js App Router, export them as `POST` and `GET` handlers. In Hono, call `chat(c.req.raw)`.

```ts
import { BlazingAgents } from "@blazingagents/sdk";
import { safeValidateUIMessages } from "ai";
import { z } from "zod";

/** Your sign-in check. Returns your user's ID, or null when signed out. */
declare function authenticate(request: Request): Promise<string | null>;
/** Your database table that maps each Session ID to the user who owns it. */
declare const sessionOwners: {
  get(sessionId: string): Promise<string | undefined>;
  set(sessionId: string, userId: string): Promise<void>;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const client = new BlazingAgents({ apiKey: env("BLAZING_AGENTS_API_KEY") });
const agentId = env("BLAZING_AGENTS_AGENT_ID");

const chatBody = z.object({
  message: z.unknown(),
  messageId: z.string().min(1).optional(),
  sessionId: z.string().optional(),
  trigger: z
    .enum(["submit-message", "regenerate-message"])
    .default("submit-message"),
});

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export async function chat(request: Request): Promise<Response> {
  const userId = await authenticate(request);
  if (!userId) return error(401, "Sign in first.");
  const body = chatBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return error(400, "Invalid request body.");
  const validated = await safeValidateUIMessages({
    messages: [body.data.message],
  });
  const [message] = validated.success ? validated.data : [];
  if (message?.role !== "user") return error(400, "Invalid message.");
  const { messageId, sessionId, trigger } = body.data;
  if (sessionId && (await sessionOwners.get(sessionId)) !== userId) {
    return error(403, "Session not found.");
  }

  const turn = { agentId, message, messageId, userId, abortSignal: request.signal };
  const result = sessionId
    ? await client.chat({ ...turn, sessionId, trigger })
    : await client.chat(turn);
  if (!sessionId) await sessionOwners.set(await result.sessionId, userId);
  return result.toResponse();
}

export async function history(request: Request): Promise<Response> {
  const userId = await authenticate(request);
  if (!userId) return error(401, "Sign in first.");
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId || (await sessionOwners.get(sessionId)) !== userId) {
    return error(403, "Session not found.");
  }
  const page = await client.sessions.messages({ agentId, sessionId, limit: 200 });
  return Response.json({ messages: page.data });
}
```

The same backend in Python with FastAPI. The SDK returns the raw stream bytes; relay them unchanged and copy the `Location` header on the first Turn so the frontend learns the Session ID.

```python
import os
from typing import Any, Literal

from blazing_agents import APIStatusError, AsyncBlazingAgents, BlazingAgentsError
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

client = AsyncBlazingAgents()  # reads BLAZING_AGENTS_API_KEY
AGENT_ID = os.environ["BLAZING_AGENTS_AGENT_ID"]
app = FastAPI()


def current_user(request: Request) -> str:
    """Your sign-in check. Return your user's ID or raise HTTPException(401)."""
    raise NotImplementedError


def owner_of(session_id: str) -> str | None:
    """Read the owner of a Session from your database."""
    raise NotImplementedError


def record_owner(session_id: str, user_id: str) -> None:
    """Save the owner of a new Session in your database."""
    raise NotImplementedError


class ChatBody(BaseModel):
    message: dict[str, object]
    messageId: str | None = None
    sessionId: str | None = None
    trigger: Literal["submit-message", "regenerate-message"] = "submit-message"


@app.post("/api/chat")
async def chat(body: ChatBody, user_id: str = Depends(current_user)):
    if body.message.get("role") != "user":
        raise HTTPException(400, "Invalid message.")
    if body.sessionId is not None and owner_of(body.sessionId) != user_id:
        raise HTTPException(403, "Session not found.")
    headers = {"cache-control": "no-cache", "x-vercel-ai-ui-message-stream": "v1"}
    try:
        if body.sessionId is None:
            stream = await client.chat(
                agent_id=AGENT_ID, message=body.message, user_id=user_id
            )
            record_owner(stream.session_id, user_id)
            headers["location"] = stream.headers["location"]
        else:
            extra: dict[str, Any] = {"message_id": body.messageId} if body.messageId else {}
            stream = await client.chat(
                agent_id=AGENT_ID,
                session_id=body.sessionId,
                message=body.message,
                trigger=body.trigger,
                user_id=user_id,
                **extra,
            )
    except APIStatusError as exc:
        return JSONResponse({"error": exc.code}, status_code=exc.status_code)
    except BlazingAgentsError:
        return JSONResponse({"error": "upstream_error"}, status_code=502)
    return StreamingResponse(stream, media_type="text/event-stream", headers=headers)


@app.get("/api/chat/history")
async def history(
    session_id: str = Query(alias="sessionId"),
    user_id: str = Depends(current_user),
):
    if owner_of(session_id) != user_id:
        raise HTTPException(403, "Session not found.")
    page = await client.sessions.messages(
        agent_id=AGENT_ID, session_id=session_id, limit=200
    )
    return {
        "messages": [
            m.model_dump(mode="json", by_alias=True, exclude_unset=True)
            for m in page.data
        ]
    }
```

3. Add the React chat. `ChatPage` loads saved history for the stored Session, then mounts `Chat`. `Chat` keeps a copy of the last successful conversation and restores it after an error or Stop, leaving the typed text in the box for an edited or unchanged resend.

```tsx
import { useChat } from "@ai-sdk/react";
import { BlazingAgentsChatTransport } from "@blazingagents/sdk";
import { generateId, type UIMessage } from "ai";
import { type FormEvent, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "chat-session";

interface Conversation {
  key: string;
  sessionId?: string;
  messages: UIMessage[];
}

export function ChatPage({ token }: { token: string }) {
  const [conversation, setConversation] = useState<Conversation>();

  useEffect(() => {
    const sessionId = localStorage.getItem(STORAGE_KEY);
    if (!sessionId) return setConversation({ key: generateId(), messages: [] });
    void fetch(`/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { authorization: `Bearer ${token}` },
    }).then(async (response) => {
      if (!response.ok) {
        localStorage.removeItem(STORAGE_KEY);
        return setConversation({ key: generateId(), messages: [] });
      }
      const body: { messages: UIMessage[] } = await response.json();
      setConversation({ key: generateId(), sessionId, messages: body.messages });
    });
  }, [token]);

  if (!conversation) return <p>Loading...</p>;
  return (
    <Chat
      key={conversation.key}
      token={token}
      conversation={conversation}
      onNewConversation={() => {
        localStorage.removeItem(STORAGE_KEY);
        setConversation({ key: generateId(), messages: [] });
      }}
    />
  );
}

function Chat({
  token,
  conversation,
  onNewConversation,
}: {
  token: string;
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
        onSessionId: (id) => localStorage.setItem(STORAGE_KEY, id),
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

- **History lives in BA.** Send only the newest user message. The transport already does this; a custom client that posts the whole `messages` array gets rejected by your `chat` handler.
- **Take `agentId` and `userId` from your server state, never the request body.** `userId` is Attribution for usage and reporting. It grants no access; your `sessionOwners` check is what keeps users out of each other's Sessions.
- **Save the owner before returning the stream.** The Session ID arrives before the answer streams. Keep it even when the first Turn fails or is stopped; the Session exists and is simply empty.
- **Keep one transport per conversation.** `useChat` ignores a new transport after mount. To switch Session or user, remount `Chat` with a new `key`, as `ChatPage` does.
- **Resend is a new attempt.** Give every send a fresh message ID; message IDs are not idempotency keys. A failed or stopped Turn adds nothing to history, so the edited or unchanged text is simply sent again.
- **Tool effects can repeat.** Stop cancels the Turn but cannot undo a Tool call that already ran, and a resend can run it again (for example, a second email). Make side-effecting Tools safe to repeat or gate them with [human approval](human-approval.md).
- **A lost response may already be saved.** A dropped connection is not proof of failure. Reload history before telling the user their message was lost.
- **Regenerate only after a successful answer.** A prompt that failed was never saved, so there is nothing to regenerate. If regeneration fails or is stopped, the old answer stays.
- **`session_busy` (HTTP 409)** means a Tool approval is pending or an approved call is still running. Show the error and let the user send again later.
- **Older history.** `sessions.messages` returns the newest page, oldest first. Pass `nextCursor` back as `cursor` to load earlier pages for long conversations.
- **Proxies must not buffer the stream.** `toResponse()` sets `cache-control: no-cache`; make sure every proxy in front of your backend passes chunks through as they arrive.

## Check it works

- Send "Remember the word cobalt.", then "Which word did I ask you to remember?". The second answer says cobalt.
- Reload the page. The earlier messages appear, and the next message continues the same conversation.
- Call `POST /api/chat` without your sign-in, and you get 401. Call it as a second user with the first user's Session ID, and you get 403.
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
