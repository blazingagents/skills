# Add chat to your app

You will have a streaming chat UI in your web app. Each signed-in user gets their own conversations, can reopen them with history, and can stop, resend, and regenerate answers. While the Agent works, users can keep typing. New messages wait in the client's own queue, and any queued message can be sent to the running Turn as steering.

## When to use this

Your users chat with an Agent inside your own web product, and conversations must survive page reloads. If you instead want the Agent inside Slack or Telegram, read [Slack and Telegram](slack-and-telegram.md). If you want one-shot text with no conversation, use `client.completion()` from [the TypeScript SDK reference](../sdk-typescript.md).

## How it works

Your browser talks only to your backend. The backend authenticates the user and calls BA through `client.forUser(verifiedUserId)`. BA checks that the Agent and Session belong to that user. BA stores the history, so each request carries only the newest message and the Session ID. The first response returns a new Session ID in `Location`. AI SDK `useChat` and `BlazingAgentsChatTransport` render the stream and keep that ID for later messages.

BA holds no queue. A message sent while the Session is busy either steers the running Turn or waits in your client's own queue until the Turn settles, when your client sends the waiting messages as ordinary chat — one per Turn, or several in one Turn with `client.chat({ messages: [...] })`. `sessions.submitInput()` steers: it takes your `requestId` and the message, binds it to the running Turn, and returns a receipt. A `steer_not_available` (409) means no Turn can take a steer — the Session is idle, stopping, or waiting on an approval — so the message stays queued locally. `sessions.inputs()` returns the steer receipts and the Session's `activity`; poll it while the Session is busy. A receipt ends `committed` (saved in history), `not_placed` (the agent never read it — safe to send as ordinary chat), or `uncertain` (it may have reached the agent — never resend automatically). `sessions.stop()` records cancellation for a Turn ID and returns immediately; keep reading the existing stream until the Turn settles.

## Build it

1. Install the packages. Your backend needs `@blazingagents/sdk` (or `blazing-agents` for Python). Your React frontend needs `@blazingagents/sdk`, `ai`, and `@ai-sdk/react`.

```bash
npm install @blazingagents/sdk ai @ai-sdk/react zod
# Python backend instead:
pip install blazing-agents fastapi uvicorn
```

These APIs need `@blazingagents/sdk` 0.20.0 or `blazing-agents` 0.14.0 or newer.

2. Add the backend. `chat` relays one Turn and `history` returns a Session's saved messages. Mount them as `POST /api/chat` and `GET /api/chat/history` in your framework. In the Next.js App Router, export them as `POST` and `GET` handlers. In Hono, call `chat(c.req.raw)`. Authenticate the user, select their Agent in backend code, validate the request body, then call the scoped client. `sessions.messages()` returns the native UIMessage page. Return its cursors with the messages for older-history controls.

`chat` accepts either one `message` or a `messages` array. The array is how queued messages go out after a busy Turn settles: several user messages run in one Turn, in order, each saved to history. A batch always needs a Session ID.

```ts
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";
import { sessionIdSchema } from "@blazingagents/sdk/contracts";
import { safeValidateUIMessages } from "ai";
import { z } from "zod";

declare function authenticate(request: Request): Promise<{ id: string; agentId: string } | null>;
const tenant = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });
const chatBody = z.object({
  message: z.unknown().optional(),
  messages: z.array(z.unknown()).optional(),
  messageId: z.string().min(1).optional(),
  sessionId: sessionIdSchema.optional(),
  trigger: z.enum(["submit-message", "regenerate-message"]).default("submit-message"),
});

export async function chat(request: Request): Promise<Response> {
  const user = await authenticate(request);
  if (!user) return new Response("Sign in first.", { status: 401 });
  try {
    const body = chatBody.parse(await request.json());
    const raw = body.messages ?? (body.message === undefined ? [] : [body.message]);
    const validated = await safeValidateUIMessages({ messages: raw });
    if (!validated.success || validated.data.some((m) => m.role !== "user")) {
      return new Response("Invalid message.", { status: 400 });
    }
    const client = tenant.forUser(user.id);
    const shared = {
      agentId: user.agentId,
      messageId: body.messageId,
      abortSignal: request.signal,
    };
    let result;
    if (body.messages !== undefined) {
      if (body.sessionId === undefined) {
        return new Response("A batch needs a Session.", { status: 400 });
      }
      result = await client.chat({
        ...shared,
        messages: validated.data,
        sessionId: body.sessionId,
      });
    } else {
      const input = { ...shared, message: validated.data[0] };
      result = await client.chat(body.sessionId === undefined
        ? { ...input, trigger: "submit-message" }
        : { ...input, sessionId: body.sessionId, trigger: body.trigger });
    }
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
  const parsed = sessionIdSchema.safeParse(params.get("sessionId"));
  if (!parsed.success) return new Response("Invalid Session ID.", { status: 400 });
  const sessionId = parsed.data;
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
from pydantic import BaseModel, Field

client = AsyncBlazingAgents()  # reads BLAZING_AGENTS_API_KEY
SESSION_ID = r"^ss_[0-9A-Za-z]{16}$"
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
    message: dict[str, object] | None = None
    messages: list[dict[str, object]] | None = None
    messageId: str | None = None
    sessionId: str | None = Field(default=None, pattern=SESSION_ID)
    trigger: Literal["submit-message", "regenerate-message"] = "submit-message"


@app.post("/api/chat")
async def chat(body: ChatBody, user_id: str = Depends(current_user)):
    raw = body.messages if body.messages is not None else ([body.message] if body.message else [])
    if not raw or any(m.get("role") != "user" for m in raw):
        raise HTTPException(400, "Invalid message.")
    headers = {"cache-control": "no-cache", "x-vercel-ai-ui-message-stream": "v1"}
    extra: dict[str, Any] = {"extra_headers": {"X-BA-User-Id": user_id}}
    if body.messageId:
        extra["message_id"] = body.messageId
    try:
        if body.messages is not None:
            if body.sessionId is None:
                raise HTTPException(400, "A batch needs a Session.")
            stream = await client.chat(
                agent_id=agent_for_user(user_id),
                session_id=body.sessionId,
                messages=raw,
                user_id=user_id,
                **extra,
            )
        elif body.sessionId is None:
            stream = await client.chat(
                agent_id=agent_for_user(user_id), message=raw[0], user_id=user_id, **extra
            )
            headers["location"] = stream.headers["location"]
        else:
            stream = await client.chat(
                agent_id=agent_for_user(user_id),
                session_id=body.sessionId,
                message=raw[0],
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
    session_id: str = Query(alias="sessionId", pattern=SESSION_ID),
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

3. Add the Session endpoints. `GET /api/chat/session` returns the Session's steer receipts and activity. `POST /api/chat/steer` submits one message as a steer to the running Turn. `POST /api/chat/stop` stops the running Turn by its `turnId`. Every call goes through the same verified user scope as `chat`. Deleting a queued message needs no endpoint: the queue lives in the browser, so the client just drops the row.

```ts
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";
import { sessionIdSchema as sessionId, sessionInputRequestIdSchema as requestId, stopSessionBodySchema } from "@blazingagents/sdk/contracts";
import { safeValidateUIMessages } from "ai";
import { z } from "zod";

declare function authenticate(request: Request): Promise<{ id: string; agentId: string } | null>;
const tenant = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });
const turnId = stopSessionBodySchema.shape.turnId;
const steerBody = z.object({ sessionId, requestId, message: z.unknown() });
const stopBody = z.object({ sessionId, turnId });

function failure(error: unknown): Response {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return Response.json({ error: { code: "invalid_request" } }, { status: 400 });
  }
  if (BlazingAgentsError.isInstance(error)) {
    return Response.json({ error: { code: error.code } }, { status: error.status ?? 502 });
  }
  throw error;
}

export async function session(request: Request): Promise<Response> {
  const user = await authenticate(request);
  if (!user) return new Response("Sign in first.", { status: 401 });
  try {
    const id = sessionId.parse(new URL(request.url).searchParams.get("sessionId"));
    const page = await tenant.forUser(user.id).sessions.inputs({
      agentId: user.agentId,
      sessionId: id,
      includeCompleted: true,
      abortSignal: request.signal,
    });
    return Response.json(page);
  } catch (error) {
    return failure(error);
  }
}

export async function steer(request: Request): Promise<Response> {
  const user = await authenticate(request);
  if (!user) return new Response("Sign in first.", { status: 401 });
  try {
    const body = steerBody.parse(await request.json());
    const validated = await safeValidateUIMessages({ messages: [body.message] });
    if (!validated.success || validated.data[0].role !== "user") {
      return Response.json({ error: { code: "invalid_request" } }, { status: 400 });
    }
    return Response.json(await tenant.forUser(user.id).sessions.submitInput({
      agentId: user.agentId,
      sessionId: body.sessionId,
      requestId: body.requestId,
      message: validated.data[0],
      abortSignal: request.signal,
    }));
  } catch (error) {
    return failure(error);
  }
}

export async function stop(request: Request): Promise<Response> {
  const user = await authenticate(request);
  if (!user) return new Response("Sign in first.", { status: 401 });
  try {
    const body = stopBody.parse(await request.json());
    return Response.json(await tenant.forUser(user.id).sessions.stop({
      agentId: user.agentId,
      sessionId: body.sessionId,
      turnId: body.turnId,
      abortSignal: request.signal,
    }));
  } catch (error) {
    return failure(error);
  }
}
```

Mount `session` as `GET /api/chat/session`, `steer` as `POST /api/chat/steer`, and `stop` as `POST /api/chat/stop`. In Python, add three routes to the FastAPI app from step 2; the first lines repeat its client and sign-in hooks:

```python
from typing import Annotated, Any

from blazing_agents import APIStatusError, AsyncBlazingAgents, BlazingAgentsError
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import AfterValidator, BaseModel, Field

client = AsyncBlazingAgents()
app = FastAPI()
SESSION_ID = r"^ss_[0-9A-Za-z]{16}$"
TURN_ID = r"^turn_[0-9A-Za-z]{16}$"


def not_dot_segment(value: str) -> str:
    if value in (".", ".."):
        raise ValueError("requestId must not be '.' or '..'")
    return value


RequestId = Annotated[str, Field(min_length=1, max_length=128), AfterValidator(not_dot_segment)]


def current_user() -> str:
    """Your sign-in check. Return your user's ID or raise HTTPException(401)."""
    raise NotImplementedError


def agent_for_user(user_id: str) -> str:
    """Read this user's Agent ID from trusted backend state."""
    raise NotImplementedError


class SteerBody(BaseModel):
    sessionId: str = Field(pattern=SESSION_ID)
    requestId: RequestId
    message: dict[str, object]


class StopBody(BaseModel):
    sessionId: str = Field(pattern=SESSION_ID)
    turnId: str = Field(pattern=TURN_ID)


def scope(user_id: str, session_id: str) -> dict[str, Any]:
    return {
        "agent_id": agent_for_user(user_id),
        "session_id": session_id,
        "extra_headers": {"X-BA-User-Id": user_id},
    }


@app.get("/api/chat/session")
async def session(
    session_id: str = Query(alias="sessionId", pattern=SESSION_ID),
    user_id: str = Depends(current_user),
):
    try:
        page = await client.sessions.inputs(
            **scope(user_id, session_id), include_completed=True
        )
    except APIStatusError as exc:
        raise HTTPException(exc.status_code, detail={"code": exc.code}) from exc
    except BlazingAgentsError as exc:
        raise HTTPException(502, detail={"code": "upstream_error"}) from exc
    return page.model_dump(mode="json", by_alias=True)


@app.post("/api/chat/steer")
async def steer(body: SteerBody, user_id: str = Depends(current_user)):
    if body.message.get("role") != "user":
        raise HTTPException(400, "Invalid message.")
    try:
        result = await client.sessions.submit_input(
            **scope(user_id, body.sessionId),
            request_id=body.requestId,
            message=body.message,
        )
    except APIStatusError as exc:
        return JSONResponse({"error": {"code": exc.code}}, status_code=exc.status_code)
    except BlazingAgentsError:
        return JSONResponse({"error": {"code": "upstream_error"}}, status_code=502)
    return result.model_dump(mode="json", by_alias=True)


@app.post("/api/chat/stop")
async def stop(body: StopBody, user_id: str = Depends(current_user)):
    try:
        result = await client.sessions.stop(
            **scope(user_id, body.sessionId), turn_id=body.turnId
        )
    except APIStatusError as exc:
        return JSONResponse({"error": {"code": exc.code}}, status_code=exc.status_code)
    except BlazingAgentsError:
        return JSONResponse({"error": {"code": "upstream_error"}}, status_code=502)
    return result.model_dump(mode="json", by_alias=True)
```

4. Add the React chat. `ChatPage` loads saved history for the stored Session, then mounts `Chat`. `Chat` keeps a copy of the last successful conversation and restores it after an error or Stop, putting the sent text back in the box for an edited or unchanged resend. While the Session is busy, the composer's button reads Stop until the user types, then Send; a send adds the message to the local `queue`. The `queue` block above the composer lists each waiting message on one line with Send (steer the running Turn now) and Delete (drop it — it was never sent). `Chat` polls `GET /api/chat/session` while the Session is busy or a steer is pending. When the Session is idle and messages wait, `Chat` shows that batch of user messages and calls `resumeStream()`, which posts them to `/api/chat` through a second AI SDK transport as a `messages` array and streams the answer; after that Turn ends it reloads saved history. `Chat` sends each set of waiting messages once; after a failed send, it waits for the user.

```tsx
import { useChat } from "@ai-sdk/react";
import { BlazingAgentsChatTransport, type SessionActivity, type SessionInput } from "@blazingagents/sdk";
import { type ChatTransport, DefaultChatTransport, generateId, type UIMessage } from "ai";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

interface Conversation {
  key: string;
  sessionId?: string;
  messages: UIMessage[];
}

/** A message this client sent as a steer, with its receipt state once known. */
interface Steer {
  requestId: string;
  message: UIMessage;
  state: "sending" | SessionInput["state"];
  turnId?: string;
}

const idle: SessionActivity = { state: "idle", turnId: null };

function textOf(message: { parts: readonly { type: string }[] }): string {
  return message.parts.map((part) => ("text" in part && typeof part.text === "string" ? part.text : "")).join("");
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
  const [sessionId, setSessionId] = useState(conversation.sessionId);
  const [queue, setQueue] = useState<UIMessage[]>([]);
  const [steered, setSteered] = useState<Steer[]>([]);
  const [activity, setActivity] = useState<SessionActivity>(idle);
  const [queueError, setQueueError] = useState<string>();
  const saved = useRef(conversation.messages);
  const sending = useRef(false);
  const sent = useRef("");
  const pendingBatch = useRef<UIMessage[]>([]);
  const steeredRef = useRef(steered);
  steeredRef.current = steered;
  const lastTurn = useRef<string | null>(null);
  const reloadAfterTurn = useRef(false);
  const [transport] = useState((): ChatTransport<UIMessage> => {
    const headers = { authorization: `Bearer ${token}` };
    const relay = new BlazingAgentsChatTransport({
      api: "/api/chat",
      headers,
      sessionId: conversation.sessionId,
      onSessionId: (id) => {
        localStorage.setItem(storageKey, id);
        setSessionId(id);
      },
    });
    const batch = new DefaultChatTransport<UIMessage>({ api: "/api/chat", headers });
    return {
      sendMessages: (options) => relay.sendMessages(options),
      // resumeStream() arrives here; it sends the waiting messages as one Turn.
      reconnectToStream: ({ abortSignal, ...options }) =>
        batch.sendMessages({ ...options, abortSignal, trigger: "submit-message", messageId: undefined, messages: pendingBatch.current }),
    };
  });
  const chat = useChat({
    transport,
    messages: conversation.messages,
    onError() {
      sending.current = false;
      const unsent = pendingBatch.current;
      pendingBatch.current = [];
      chat.setMessages(saved.current);
      setInput((current) =>
        current || sent.current || unsent.map(textOf).filter(Boolean).join("\n"));
    },
    onFinish({ messages, finishReason, isAbort, isError, isDisconnect }) {
      sending.current = false;
      if (isAbort || isError || isDisconnect || !finishReason || finishReason === "error") {
        const unsent = pendingBatch.current;
        pendingBatch.current = [];
        chat.setMessages(saved.current);
        setInput((current) =>
          current || sent.current || unsent.map(textOf).filter(Boolean).join("\n"));
        return;
      }
      pendingBatch.current = [];
      saved.current = messages;
    },
  });
  const stopOnUnmount = useRef(chat.stop);
  stopOnUnmount.current = chat.stop;
  useEffect(() => () => { void stopOnUnmount.current(); }, []);
  const streaming = chat.status === "submitted" || chat.status === "streaming";
  const { state, turnId } = activity;
  const busy = streaming || state === "running" || state === "stopping" || state === "approval";
  const pendingSteers = steered.filter(
    (item) => item.state === "sending" || item.state === "accepted" || item.state === "delivered",
  );
  const uncertain = steered.filter((item) => item.state === "uncertain");
  const hasAnswer = chat.messages.some((message) => message.role === "assistant");

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const response = await fetch(`/api/chat/session?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const body: { data: SessionInput[]; activity: SessionActivity } = await response.json();
    const receipts = new Map(body.data.map((receipt) => [receipt.requestId, receipt]));
    setActivity(body.activity);
    // Reconcile steers with their receipts; never rebuild the queue from them.
    setSteered((current) => current.map((item) => {
      const receipt = receipts.get(item.requestId);
      return receipt ? { ...item, state: receipt.state, turnId: receipt.turnId } : item;
    }));
    return body.activity;
  }, [sessionId, token]);

  const watching = Boolean(sessionId) && (busy || queue.length > 0 || pendingSteers.length > 0);
  useEffect(() => {
    void refresh().catch(() => undefined);
    if (!watching) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 1000);
    return () => clearInterval(timer);
  }, [watching, refresh]);

  const { setMessages, resumeStream } = chat;
  useEffect(() => {
    if (!sessionId || streaming || state !== "idle" || queue.length === 0 || chat.error) return;
    pendingBatch.current = queue;
    setQueue([]);
    sent.current = "";
    const shown = new Set(saved.current.map((message) => message.id));
    setMessages([...saved.current, ...queue.filter((message) => !shown.has(message.id))]);
    void resumeStream({ body: { sessionId } });
  }, [sessionId, streaming, state, queue, chat.error, setMessages, resumeStream]);

  useEffect(() => {
    if (lastTurn.current !== null && lastTurn.current !== turnId) reloadAfterTurn.current = true;
    lastTurn.current = turnId;
    if (!reloadAfterTurn.current || streaming || !sessionId) return;
    const controller = new AbortController();
    void fetch(`/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const body: { messages: UIMessage[] } = await response.json();
        reloadAfterTurn.current = false;
        saved.current = body.messages;
        setMessages(body.messages);
        const savedIds = new Set(body.messages.map((message) => message.id));
        // not_placed steers never reached the agent, so they rejoin the queue;
        // committed ones are in history; uncertain ones stay flagged.
        const requeue = steeredRef.current
          .filter((item) => item.state === "not_placed" && !savedIds.has(item.message.id))
          .map((item) => item.message);
        setSteered(steeredRef.current.filter((item) =>
          item.state !== "not_placed" &&
          item.state !== "committed" &&
          !savedIds.has(item.message.id)));
        if (requeue.length) setQueue((existing) => [...existing, ...requeue]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [turnId, streaming, sessionId, token, setMessages]);

  async function steer(item: UIMessage) {
    // Dequeue before sending: a queued row is "not sent yet" by definition.
    setQueue((current) => current.filter((queued) => queued.id !== item.id));
    setQueueError(undefined);
    const requestId = generateId();
    setSteered((current) => [...current, { requestId, message: item, state: "sending" }]);
    try {
      const response = await fetch("/api/chat/steer", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ sessionId, requestId, message: item }),
      });
      const body: { data?: SessionInput; error?: { code?: string } } = await response
        .json()
        .catch(() => ({}));
      if (!response.ok) {
        setSteered((current) => current.filter((entry) => entry.requestId !== requestId));
        if (response.status < 500) {
          // A refusal (for example steer_not_available) saved nothing; the
          // message simply waits again.
          setQueue((current) => [...current, item]);
        } else {
          // The server may have saved it; flag it instead of resending.
          setSteered((current) => [
            ...current,
            { requestId, message: item, state: "uncertain" },
          ]);
        }
        setQueueError(body.error?.code ?? `HTTP ${response.status}`);
      } else {
        const receipt = body.data;
        setSteered((current) =>
          current.map((entry) =>
            entry.requestId === requestId
              ? { ...entry, state: receipt?.state ?? "accepted", turnId: receipt?.turnId }
              : entry,
          ),
        );
      }
    } catch {
      // The outcome is unknown; flag it instead of resending automatically.
      setSteered((current) =>
        current.map((entry) =>
          entry.requestId === requestId ? { ...entry, state: "uncertain" } : entry,
        ),
      );
      setQueueError("network_error");
    }
    await refresh().catch(() => undefined);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    if (sessionId && (busy || queue.length > 0)) {
      setQueue((current) => [
        ...current,
        { id: generateId(), role: "user", parts: [{ type: "text", text }] },
      ]);
      setInput("");
      return;
    }
    if (sending.current) return;
    sending.current = true;
    sent.current = text;
    setInput("");
    chat.clearError();
    void chat.sendMessage({ id: generateId(), role: "user", parts: [{ type: "text", text }] });
  }

  async function stop() {
    const current = turnId ?? (await refresh().catch(() => undefined))?.turnId;
    if (current) {
      await fetch("/api/chat/stop", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ sessionId, turnId: current }),
      }).catch(() => undefined);
      // The stop is recorded at once; the stream still reports the end.
      await refresh().catch(() => undefined);
    }
    if (streaming) {
      await chat.stop();
      chat.setMessages(saved.current);
    }
    sending.current = false;
  }

  function regenerate() {
    if (sending.current || !hasAnswer) return;
    sending.current = true;
    sent.current = "";
    chat.clearError();
    void chat.regenerate();
  }

  const occupied = busy || queue.length > 0;
  const reading = steered.filter(
    (item) =>
      item.state !== "uncertain" &&
      !chat.messages.some((message) => message.id === item.message.id),
  );
  return (
    <main>
      {[...chat.messages, ...reading.map((item) => item.message)].map((message) => (
        <p key={message.id}>
          <strong>{message.role}:</strong> {textOf(message)}
        </p>
      ))}
      {busy && !streaming && (
        <p role="status">{state === "approval" ? "Waiting for a tool approval." : "The agent is working."}</p>
      )}
      {state === "idle" && chat.error && queue.length > 0 && (
        <div role="alert">
          <p>
            The last Turn did not finish. Waiting messages are kept.{" "}
            <button type="button" onClick={() => chat.clearError()}>Send them now</button>
          </p>
        </div>
      )}
      {uncertain.map((item) => (
        <p key={item.requestId} role="alert">
          May not have been delivered: {textOf(item.message)}{" "}
          <button
            type="button"
            onClick={() => {
              setSteered((current) => current.filter((entry) => entry.requestId !== item.requestId));
              setQueue((existing) => [...existing, item.message]);
            }}
          >
            Send again
          </button>{" "}
          <button
            type="button"
            onClick={() =>
              setSteered((current) => current.filter((entry) => entry.requestId !== item.requestId))
            }
          >
            Dismiss
          </button>
        </p>
      ))}
      {queue.length > 0 && (
        <section aria-label="queue">
          <h2>queue</h2>
          {queue.map((item) => (
            <div key={item.id} style={{ display: "flex", gap: 8 }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {textOf(item)}
              </span>
              {busy && (
                <button type="button" onClick={() => void steer(item)}>
                  Send
                </button>
              )}
              <button
                type="button"
                onClick={() => setQueue((current) => current.filter((queued) => queued.id !== item.id))}
              >
                Delete
              </button>
            </div>
          ))}
        </section>
      )}
      <form onSubmit={send}>
        <textarea
          aria-label="Message"
          rows={2}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
        />
        {busy && !input.trim() ? (
          <button type="button" onClick={() => void stop()} disabled={state === "stopping"}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>Send</button>
        )}
        <button type="button" onClick={regenerate} disabled={occupied || !hasAnswer}>Regenerate</button>
        <button type="button" onClick={onNewConversation} disabled={occupied}>New conversation</button>
      </form>
      {(queueError ?? chat.error) && <p role="alert">{queueError ?? chat.error?.message}</p>}
    </main>
  );
}
```

## Add a requested fork

Session forking requires `@blazingagents/sdk` 0.21.0 or `blazing-agents` 0.15.0 or newer.

The chat example above does not ship a fork control. To add one, have your backend read the Session transcript under the signed-in user's scope and select the exact assistant message the user chose. Offer the action only for top-level `branchable: true`; a completed-looking Tool part or closed stream does not prove eligibility.

Persist one idempotency key for that user action before calling the SDK. Keep the source and selected message fixed on retries. The TypeScript call is `client.sessions.fork({ agentId, sessionId, messageId, idempotencyKey })`; Python uses `client.sessions.fork(agent_id, session_id, message_id=message_id, idempotency_key=idempotency_key)`. The async Python client awaits the same operation.

Return the child's Session ID and switch the conversation using the same Session-switching flow as other saved Sessions. Load its saved history and send future messages through ordinary `chat()` with the child's ID. Keep source and child queues separate. The child starts idle, includes the selected reply, and inherits the saved Agent configuration and user label. No model or Tool runs during creation. Workspace files and Memories remain shared/live, and later child Turns incur normal token usage.

After a lost acknowledgement, reuse the exact key and selection to recover the same child. Do not create a new key as a retry. Handle `idempotency_conflict` by restoring the original selection; reload history after `session_fork_unavailable`; stop retrying a deleted child after `session_fork_deleted`. A successful replay works even after source deletion. Eligible replies inherited into the child can be forked again.

## Gotchas

- **History lives in BA.** Send only new user messages — one `message`, or a `messages` batch of the ones that waited. A client that posts the whole conversation gets a 400: the handler accepts user messages only.
- **Validate every ID before it reaches a URL.** The browser sends `sessionId`, `turnId`, and `requestId`, and the SDK places them in request paths. A value such as `../../ag_other/sessions/ss_x` or `..` would make the request reach another route. Check them at your relay as the handlers do: `sessionIdSchema` and `sessionInputRequestIdSchema` from `@blazingagents/sdk/contracts` in TypeScript, and the same patterns in Python. A `requestId` of `.` or `..` is invalid.
- **Derive scope from verified sign-in.** BA enforces ownership when you use `forUser()`. A body `userId` alone grants no access.
- **Save the Session ID.** The transport receives it before the answer streams. Keep it even when the first Turn fails or is stopped; the Session exists and is simply empty.
- **Keep one transport per conversation.** `useChat` ignores a new transport after mount. To switch Session or user, remount `Chat` with a new `key`, as `ChatPage` does. Clear persisted user data on sign-out and abort requests from the old account.
- **Resend is a new attempt.** Give every send a fresh message ID; message IDs are not idempotency keys. A failed or stopped Turn adds nothing to history, so the edited or unchanged text is simply sent again.
- **Tool effects can repeat.** Stop cancels the Turn but cannot undo a Tool call that already ran, and a resend can run it again (for example, a second email). Make side-effecting Tools safe to repeat or gate them with [human approval](human-approval.md).
- **A lost response may already be saved.** A dropped connection is not proof of failure. Reload history before telling the user their message was lost.
- **Regenerate only after a successful answer.** A prompt that failed was never saved, so there is nothing to regenerate. If regeneration fails or is stopped, the old answer stays.
- **`session_busy` (HTTP 409)** from `chat` means a Tool approval is pending, a continuation is running, or another Turn holds the Session, for example one started from another tab. Steer the running Turn, or hold the message in the queue and let the next dispatch send it.
- **Queue only after the Session exists.** The first message creates the Session through `chat`. Steers and batches need a Session ID, which the transport receives before the answer streams.
- **The queue is yours.** It lives in client state — `useState`, localStorage, or your own store. Take a message out before sending it (a queued row means "not sent"), never auto-retry a send whose outcome is unknown, and never rebuild the queue from receipts or history: the chat endpoint does not reject a message ID already in history, so a rebuilt queue can send a message twice.
- **Keep the `requestId` until the outcome is known.** `submitInput` saves the steer before it returns, so a lost response may still have placed it. Retry with the same `requestId` and message; a changed payload under the same `requestId`, or the same message ID under a new one, returns `input_idempotency_conflict`.
- **A steer is provisional until history catches up.** The `data-ba-steer-consumed` chunk on the running stream means the agent took the message; it is not yet proof of a durable save. `committed` proves it, `not_placed` means it never ran (safe to send as chat), and `uncertain` means it may have run — flag it and let the user decide, as `Chat` does.
- **Steering stops at tool approvals.** An approval wait refuses new steers with `steer_not_available`, so a message sent then stays queued and goes out after the continuation settles. A steer already taken does not cross the pause either: it lands in history only if the Turn that read it commits.
- **Your client sends every waiting message.** Poll `GET /api/chat/session` while the Session is busy; once activity is `idle` and messages wait, `Chat` posts them to `/api/chat` as one `messages` batch. There is no server queue to drain, so nothing runs without that send — reloads lose the local queue unless you persist it yourself.
- **Two tabs can send the same Session's Turns.** The second `chat` call while a Turn runs gets `session_busy`. Each tab holds only its own queue, so keep queued sends to the tab that queued them.
- **A stopped Turn's uncommitted steers rejoin the queue.** After the history reload, a steered message missing from history and marked `not_placed` never ran, so `Chat` queues it again; `uncertain` stays flagged for the user.
- **Stop without a Turn ID only aborts.** `Chat` stops by `turnId`, reading activity once if it has none yet. When there is still no Turn ID, for example while the first message is creating the Session, it can only abort the chat request — keep the draft and let the user resend.
- **Stop returns before the Turn ends.** `sessions.stop()` records cancellation and answers immediately; the `stopping` activity and the existing stream report the end. Keep reading the stream instead of polling for a stopped state.
- **Reload the newest page, not `after`.** A tool approval continuation rewrites its assistant message in place, at the same position, so `messages({ after: latestCursor })` never returns the revised tool result or answer. `Chat` reloads the newest page after each Turn and drops that reload if a new Turn or stream starts first, so an old snapshot cannot overwrite live messages.
- **Older history.** `sessions.messages` returns the newest page, oldest first. Pass `nextCursor` back as `cursor` to load earlier pages for long conversations. Prepend each older page without reversing its messages.
- **Proxies must not buffer the stream.** `toResponse()` sets `cache-control: no-cache`; make sure every proxy in front of your backend passes chunks through as they arrive.

## Check it works

- Send "Remember the word cobalt.", then "Which word did I ask you to remember?". The second answer says cobalt.
- Reload the page. The earlier messages appear in chronological order, and the next message continues the same conversation. Load an older page and verify that order again.
- Switch accounts while history loads or a reply streams. The new account shows only its own conversation.
- Call `POST /api/chat` without your sign-in, and you get 401. Call it as a second user with the first user's Session ID, and BA returns 404.
- Press Stop mid-answer. The partial answer disappears, your text returns to the box, and Send works again.
- While an answer streams, the empty composer shows Stop. Type a message, and the button turns to Send. Sending adds a one-line row to the `queue` block. Queue two more. When the answer finishes, the three appear as separate user messages and one new Turn streams its answer to them; after it ends, history shows the same messages in the same order.
- Queue a message, then press its Send. It joins the running Turn as a steer, leaves the queue, and the current answer takes it into account; after the Turn ends, history contains the message.
- Queue a message, then press Delete. It was never sent, so it never reaches the agent. Queue another and press Stop. The current Turn ends, and the queued message goes out as the next one.
- Reload while messages are queued. The queue is client state, so the rows are gone — persist it yourself if reloads must keep them.
- Steer a message, then press Stop before the agent reads it. After the Turn settles its receipt ends `not_placed`, and `Chat` queues it again.
- Reload while a batch answers. The partial answer is not replayed. Once the Session settles, the screen matches saved history.
- Retry a steer with the same `requestId` and message; you get the same receipt. Change the text under that `requestId`, and you get `input_idempotency_conflict`.
- While a Tool approval is pending, a steer returns `steer_not_available` and the message stays queued; `chat` returns `session_busy`.
- Press Regenerate. The last answer is replaced, and after a reload the new answer is the saved one.
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
