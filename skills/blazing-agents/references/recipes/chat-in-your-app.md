# Add chat to your app

You will have a streaming chat UI in your web app. Each signed-in user gets their own conversations, can reopen them with history, and can stop, resend, and regenerate answers. While the Agent works, users can keep typing. New messages wait in a queue, and any queued message can be sent to the running Turn as steering.

## When to use this

Your users chat with an Agent inside your own web product, and conversations must survive page reloads. If you instead want the Agent inside Slack or Telegram, read [Slack and Telegram](slack-and-telegram.md). If you want one-shot text with no conversation, use `client.completion()` from [the TypeScript SDK reference](../sdk-typescript.md).

## How it works

Your browser talks only to your backend. The backend authenticates the user and calls BA through `client.forUser(verifiedUserId)`. BA checks that the Agent and Session belong to that user. BA stores the history, so each request carries only the newest message and the Session ID. The first response returns a new Session ID in `Location`. AI SDK `useChat` and `BlazingAgentsChatTransport` render the stream and keep that ID for later messages.

A message sent while the Session is busy goes to the Session's inputs instead of a new chat call, which would fail with `session_busy`. `sessions.submitInput()` saves it under your `requestId` before it returns, so it survives reloads. A `queue` input waits. When the current Turn finishes or the user presses Stop, BA starts one new Turn with every waiting input, each as its own user message, in order. `promoteInput()` turns a waiting input into steering, which the running Turn reads at its next step. `deleteInput()` withdraws a waiting input. `sessions.inputs()` returns the pending inputs and the Session's `activity`; poll it while the Session is busy. A Turn that BA starts from the queue has no chat request of its own. When `activity.turnId` names one, stream it with `sessions.joinInputTurn()`. That stream uses the same format as chat and replays from the start of the Turn, so attach once per Turn and merge by message ID; disconnecting never stops the Turn. The saved answer is also in `sessions.messages()` once the Turn ends. An unexpected error pauses the queue and keeps the waiting inputs until the user resumes it with `resumeInputs()`.

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
import { sessionIdSchema } from "@blazingagents/sdk/contracts";
import { safeValidateUIMessages } from "ai";
import { z } from "zod";

declare function authenticate(request: Request): Promise<{ id: string; agentId: string } | null>;
const tenant = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });
const chatBody = z.object({
  message: z.unknown(),
  messageId: z.string().min(1).optional(),
  sessionId: sessionIdSchema.optional(),
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
    message: dict[str, object]
    messageId: str | None = None
    sessionId: str | None = Field(default=None, pattern=SESSION_ID)
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

3. Add the queue endpoints. `GET /api/chat/queue` returns the Session's pending inputs and activity. `POST /api/chat/queue` takes one action: `submit` a new message, `promote` or `delete` a waiting one, `stop` the running Turn by its `turnId`, or `resume` a paused queue. `GET /api/chat/turn` relays the live stream of a Turn started from the queue, and answers 204 when the Turn did not come from the queue. Every call goes through the same verified user scope as `chat`.

```ts
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";
import { sessionIdSchema as sessionId, sessionInputRequestIdSchema as requestId, stopSessionBodySchema } from "@blazingagents/sdk/contracts";
import { safeValidateUIMessages } from "ai";
import { z } from "zod";

declare function authenticate(request: Request): Promise<{ id: string; agentId: string } | null>;
const tenant = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });
const turnId = stopSessionBodySchema.shape.turnId;
const queueAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("submit"),
    sessionId,
    requestId,
    message: z.unknown(),
    whenBusy: z.enum(["queue", "steer"]).default("queue"),
  }),
  z.object({ action: z.enum(["promote", "delete"]), sessionId, requestId }),
  z.object({ action: z.literal("stop"), sessionId, turnId }),
  z.object({ action: z.literal("resume"), sessionId }),
]);

function failure(error: unknown): Response {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return Response.json({ error: { code: "invalid_request" } }, { status: 400 });
  }
  if (BlazingAgentsError.isInstance(error)) {
    return Response.json({ error: { code: error.code } }, { status: error.status ?? 502 });
  }
  throw error;
}

export async function queue(request: Request): Promise<Response> {
  const user = await authenticate(request);
  if (!user) return new Response("Sign in first.", { status: 401 });
  const sessions = tenant.forUser(user.id).sessions;
  const agentId = user.agentId;
  const abortSignal = request.signal;
  try {
    if (request.method === "GET") {
      const id = sessionId.parse(new URL(request.url).searchParams.get("sessionId"));
      return Response.json(await sessions.inputs({ agentId, sessionId: id, abortSignal }));
    }
    const body = queueAction.parse(await request.json());
    const scope = { agentId, sessionId: body.sessionId, abortSignal };
    switch (body.action) {
      case "submit": {
        const messages = await safeValidateUIMessages({ messages: [body.message] });
        if (!messages.success || messages.data[0].role !== "user") {
          return Response.json({ error: { code: "invalid_request" } }, { status: 400 });
        }
        const { requestId, whenBusy } = body;
        return Response.json(await sessions.submitInput({ ...scope, requestId, whenBusy, message: messages.data[0] }));
      }
      case "promote":
        return Response.json(await sessions.promoteInput({ ...scope, requestId: body.requestId }));
      case "delete":
        return Response.json(await sessions.deleteInput({ ...scope, requestId: body.requestId }));
      case "stop":
        return Response.json(await sessions.stop({ ...scope, turnId: body.turnId }));
      case "resume":
        return Response.json(await sessions.resumeInputs(scope));
    }
  } catch (error) {
    return failure(error);
  }
}

export async function turn(request: Request): Promise<Response> {
  const user = await authenticate(request);
  if (!user) return new Response("Sign in first.", { status: 401 });
  try {
    const params = new URL(request.url).searchParams;
    const result = await tenant.forUser(user.id).sessions.joinInputTurn({
      agentId: user.agentId,
      sessionId: sessionId.parse(params.get("sessionId")),
      turnId: turnId.parse(params.get("turnId")),
      abortSignal: request.signal,
    });
    return result.toResponse();
  } catch (error) {
    // Not a queued Turn, or no longer visible: tell the transport there is nothing to attach.
    if (BlazingAgentsError.isInstance(error) && error.code === "not_found") return new Response(null, { status: 204 });
    return failure(error);
  }
}
```

Mount `queue` for both `GET` and `POST /api/chat/queue`, and `turn` as `GET /api/chat/turn`. In Python, add three routes to the FastAPI app from step 2; the first lines repeat its client and sign-in hooks:

```python
from typing import Annotated, Any, Literal

from blazing_agents import APIStatusError, AsyncBlazingAgents, BlazingAgentsError
from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.responses import JSONResponse, StreamingResponse
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


class Submit(BaseModel):
    action: Literal["submit"]
    sessionId: str = Field(pattern=SESSION_ID)
    requestId: RequestId
    message: dict[str, object]
    whenBusy: Literal["queue", "steer"] = "queue"


class Change(BaseModel):
    action: Literal["promote", "delete"]
    sessionId: str = Field(pattern=SESSION_ID)
    requestId: RequestId


class Stop(BaseModel):
    action: Literal["stop"]
    sessionId: str = Field(pattern=SESSION_ID)
    turnId: str = Field(pattern=TURN_ID)


class Resume(BaseModel):
    action: Literal["resume"]
    sessionId: str = Field(pattern=SESSION_ID)


QueueAction = Annotated[Submit | Change | Stop | Resume, Field(discriminator="action")]


def scope(user_id: str, session_id: str) -> dict[str, Any]:
    return {
        "agent_id": agent_for_user(user_id),
        "session_id": session_id,
        "extra_headers": {"X-BA-User-Id": user_id},
    }


@app.get("/api/chat/queue")
async def queue(
    session_id: str = Query(alias="sessionId", pattern=SESSION_ID),
    user_id: str = Depends(current_user),
):
    try:
        page = await client.sessions.inputs(**scope(user_id, session_id))
    except APIStatusError as exc:
        raise HTTPException(exc.status_code, detail={"code": exc.code}) from exc
    except BlazingAgentsError as exc:
        raise HTTPException(502, detail={"code": "upstream_error"}) from exc
    return page.model_dump(mode="json", by_alias=True)


@app.post("/api/chat/queue")
async def queue_action(body: QueueAction, user_id: str = Depends(current_user)):
    sessions = client.sessions
    target = scope(user_id, body.sessionId)
    try:
        if isinstance(body, Submit):
            if body.message.get("role") != "user":
                raise HTTPException(400, "Invalid message.")
            result = await sessions.submit_input(
                **target, request_id=body.requestId, message=body.message, when_busy=body.whenBusy
            )
        elif isinstance(body, Change) and body.action == "promote":
            result = await sessions.promote_input(**target, request_id=body.requestId)
        elif isinstance(body, Change):
            result = await sessions.delete_input(**target, request_id=body.requestId)
        elif isinstance(body, Stop):
            result = await sessions.stop(**target, turn_id=body.turnId)
        else:
            result = await sessions.resume_inputs(**target)
    except APIStatusError as exc:
        return JSONResponse({"error": {"code": exc.code}}, status_code=exc.status_code)
    except BlazingAgentsError:
        return JSONResponse({"error": {"code": "upstream_error"}}, status_code=502)
    return result.model_dump(mode="json", by_alias=True)


@app.get("/api/chat/turn")
async def turn(
    session_id: str = Query(alias="sessionId", pattern=SESSION_ID),
    turn_id: str = Query(alias="turnId", pattern=TURN_ID),
    user_id: str = Depends(current_user),
):
    try:
        stream = await client.sessions.join_input_turn(**scope(user_id, session_id), turn_id=turn_id)
    except APIStatusError as exc:
        if exc.status_code == 404:  # Not a queued Turn: nothing to attach.
            return Response(status_code=204)
        return JSONResponse({"error": {"code": exc.code}}, status_code=exc.status_code)
    except BlazingAgentsError:
        return JSONResponse({"error": {"code": "upstream_error"}}, status_code=502)
    headers = {"cache-control": "no-cache", "x-vercel-ai-ui-message-stream": "v1"}
    return StreamingResponse(stream, media_type="text/event-stream", headers=headers)
```

4. Add the React chat. `ChatPage` loads saved history for the stored Session, then mounts `Chat`. `Chat` keeps a copy of the last successful conversation and restores it after an error or Stop, putting the sent text back in the box for an edited or unchanged resend. While the Session is busy, the composer's button reads Stop until the user types, then Send; a send queues the message. The `queue` block above the composer lists each waiting message on one line with Send (steer the running Turn now) and Delete. `Chat` polls the queue while anything is running or waiting. When BA starts a Turn from the queue, `Chat` shows its batch of user messages and calls `resumeStream()`, which reads `GET /api/chat/turn` through a second AI SDK transport; after that Turn ends it reloads saved history.

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

type QueuedInput = Omit<SessionInput, "message"> & { message: UIMessage };

interface Queue {
  inputs: QueuedInput[];
  activity: SessionActivity;
}

type QueueAction =
  | { action: "submit"; requestId: string; message: UIMessage }
  | { action: "promote" | "delete"; requestId: string }
  | { action: "stop"; turnId: string }
  | { action: "resume" };

const empty: Queue = { inputs: [], activity: { state: "idle", turnId: null, reason: null } };

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
  const [queue, setQueue] = useState(empty);
  const [queueError, setQueueError] = useState<string>();
  const saved = useRef(conversation.messages);
  const sending = useRef(false);
  const submitting = useRef(false);
  const sent = useRef("");
  const draft = useRef<{ text: string; requestId: string; messageId: string }>(undefined);
  const lastTurn = useRef<string | null>(null);
  const reloadAfterTurn = useRef(false);
  const attachTo = useRef({ sessionId: "", turnId: "" });
  const stoppedBatch = useRef<UIMessage[]>([]);
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
    // AI SDK treats a 204 from reconnectToStream as nothing to attach.
    const queuedTurn = new DefaultChatTransport<UIMessage>({
      api: "/api/chat/turn",
      headers,
      prepareReconnectToStreamRequest: ({ api }) => ({ api: `${api}?${new URLSearchParams(attachTo.current)}`, headers }),
    });
    return {
      sendMessages: (options) => relay.sendMessages(options),
      reconnectToStream: (options) => queuedTurn.reconnectToStream(options),
    };
  });
  const chat = useChat({
    transport,
    messages: conversation.messages,
    onError() {
      sending.current = false;
      chat.setMessages(saved.current);
      setInput((current) => current || sent.current);
    },
    onFinish({ messages, finishReason, isAbort, isError, isDisconnect }) {
      sending.current = false;
      if (isAbort || isError || isDisconnect || !finishReason || finishReason === "error") {
        chat.setMessages(saved.current);
        setInput((current) => current || sent.current);
        return;
      }
      saved.current = messages;
    },
  });
  const stopOnUnmount = useRef(chat.stop);
  stopOnUnmount.current = chat.stop;
  useEffect(() => () => { void stopOnUnmount.current(); }, []);
  const streaming = chat.status === "submitted" || chat.status === "streaming";
  const { state, turnId, reason } = queue.activity;
  const busy = streaming || state === "running" || state === "stopping" || state === "approval";
  const pending = queue.inputs.filter((item) => item.state === "accepted" || item.state === "delivered");
  const uncertain = queue.inputs.filter((item) => item.state === "uncertain");
  // Consumed inputs are in the agent's context but not yet in saved history.
  const reading = queue.inputs.filter(
    (item) => item.state === "consumed" && !chat.messages.some((message) => message.id === item.message.id),
  );
  const hasAnswer = chat.messages.some((message) => message.role === "assistant");

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const response = await fetch(`/api/chat/queue?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const body: { data: QueuedInput[]; activity: SessionActivity } = await response.json();
    setQueue({ inputs: body.data, activity: body.activity });
    return body.activity;
  }, [sessionId, token]);

  const watching = Boolean(sessionId) && (busy || (pending.length > 0 && state !== "paused"));
  useEffect(() => {
    void refresh().catch(() => undefined);
    if (!watching) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 1000);
    return () => clearInterval(timer);
  }, [watching, refresh]);

  const { setMessages, resumeStream } = chat;
  useEffect(() => {
    if (!sessionId || !turnId || streaming || attachTo.current.turnId === turnId) return;
    const batch = queue.inputs.filter((item) => item.turnId === turnId).map((item) => item.message);
    if (batch.length === 0) return;
    attachTo.current = { sessionId, turnId };
    sent.current = "";
    const shown = new Set(saved.current.map((message) => message.id));
    setMessages([...saved.current, ...batch.filter((message) => !shown.has(message.id))]);
    void resumeStream();
  }, [sessionId, turnId, streaming, queue.inputs, setMessages, resumeStream]);

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
        const unsaved = stoppedBatch.current.filter((message) => !savedIds.has(message.id)).map(textOf);
        stoppedBatch.current = [];
        if (unsaved.length) setInput((current) => [current, ...unsaved].filter(Boolean).join("\n"));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [turnId, streaming, sessionId, token, setMessages]);

  async function act(body: QueueAction): Promise<boolean> {
    setQueueError(undefined);
    try {
      const response = await fetch("/api/chat/queue", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ sessionId, ...body }),
      });
      if (!response.ok) {
        const failure: { error?: { code?: string } } = await response.json().catch(() => ({}));
        setQueueError(failure.error?.code ?? `HTTP ${response.status}`);
      }
      return response.ok;
    } catch {
      setQueueError("network_error");
      return false;
    } finally {
      await refresh().catch(() => undefined);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    if (sessionId && (busy || pending.length > 0 || state === "paused")) {
      if (submitting.current) return;
      if (draft.current?.text !== text) draft.current = { text, requestId: generateId(), messageId: generateId() };
      const { requestId, messageId } = draft.current;
      submitting.current = true;
      const message: UIMessage = { id: messageId, role: "user", parts: [{ type: "text", text }] };
      const queued = await act({ action: "submit", requestId, message });
      submitting.current = false;
      if (!queued) return;
      draft.current = undefined;
      setInput((current) => (current.trim() === text ? "" : current));
      if (state === "paused") await act({ action: "resume" });
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
    stoppedBatch.current = queue.inputs.filter((item) => item.turnId === current).map((item) => item.message);
    if (current) await act({ action: "stop", turnId: current });
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

  const occupied = busy || pending.length > 0;
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
      {state === "paused" && (
        <div role="alert">
          <p>
            The last Turn stopped unexpectedly ({reason}). Waiting messages are kept.{" "}
            <button type="button" onClick={() => void act({ action: "resume" })}>Resume</button>
          </p>
          {uncertain.map((item) => (
            <p key={item.requestId}>May not have been delivered: {textOf(item.message)}</p>
          ))}
        </div>
      )}
      {pending.length > 0 && (
        <section aria-label="queue">
          <h2>queue</h2>
          {pending.map((item) => (
            <div key={item.requestId} style={{ display: "flex", gap: 8 }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.mode === "steer" ? "Steering: " : ""}
                {textOf(item.message)}
              </span>
              {item.state === "accepted" && item.mode === "queue" && (
                <button type="button" onClick={() => void act({ action: "promote", requestId: item.requestId })}>
                  Send
                </button>
              )}
              {item.state === "accepted" && (
                <button type="button" onClick={() => void act({ action: "delete", requestId: item.requestId })}>
                  Delete
                </button>
              )}
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
          <button type="button" onClick={() => void stop()} disabled={state === "stopping" || state === "approval"}>
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

## Gotchas

- **History lives in BA.** Send only the newest user message. The transport already does this; a custom client that posts the whole `messages` array gets a 400 from your `chat` handler.
- **Validate every ID before it reaches a URL.** The browser sends `sessionId`, `turnId`, and `requestId`, and the SDK places them in request paths. A value such as `../../ag_other/sessions/ss_x` or `..` would make the request reach another route. Check them at your relay as the handlers do: `sessionIdSchema` and `sessionInputRequestIdSchema` from `@blazingagents/sdk/contracts` in TypeScript, and the same patterns in Python. A `requestId` of `.` or `..` is invalid.
- **Derive scope from verified sign-in.** BA enforces ownership when you use `forUser()`. A body `userId` alone grants no access.
- **Save the Session ID.** The transport receives it before the answer streams. Keep it even when the first Turn fails or is stopped; the Session exists and is simply empty.
- **Keep one transport per conversation.** `useChat` ignores a new transport after mount. To switch Session or user, remount `Chat` with a new `key`, as `ChatPage` does. Clear persisted user data on sign-out and abort requests from the old account.
- **Resend is a new attempt.** Give every send a fresh message ID; message IDs are not idempotency keys. A failed or stopped Turn adds nothing to history, so the edited or unchanged text is simply sent again.
- **Tool effects can repeat.** Stop cancels the Turn but cannot undo a Tool call that already ran, and a resend can run it again (for example, a second email). Make side-effecting Tools safe to repeat or gate them with [human approval](human-approval.md).
- **A lost response may already be saved.** A dropped connection is not proof of failure. Reload history before telling the user their message was lost.
- **Regenerate only after a successful answer.** A prompt that failed was never saved, so there is nothing to regenerate. If regeneration fails or is stopped, the old answer stays.
- **`session_busy` (HTTP 409)** from `chat` means a Tool approval is pending, an approved call is still running, or another Turn holds the Session, for example one started from another tab. Submit the message as a Session input instead. Stop also returns `session_busy` during an approval wait; decide the approval first.
- **Queue only after the Session exists.** The first message creates the Session through `chat`. Inputs need a Session ID, which the transport receives before the answer streams.
- **Keep the `requestId` until the outcome is known.** `submitInput` saves the message before it returns, so a lost response may still have queued it. Retry with the same `requestId` and message, as `Chat` does while the text is unchanged. A changed payload under the same `requestId`, or the same message ID under a new one, returns `input_idempotency_conflict`.
- **Delete and Send race with delivery.** Promote and Delete work only while an input is `accepted`. Once BA reserves it for a Turn, both return `input_not_pending`; show it as sent. A steering message the agent has read can affect the Turn even if that Turn is later stopped and not saved.
- **Steering stops at tool approvals.** Steering does not cross a tool approval. A steering message the agent has not read when an approval pause starts, or one sent while the approved call's continuation runs, waits for the next batch instead, with the same `requestId` and position. BA turns it back into a `queue` input, so its row shows Send again. Render each row from the receipt's `mode`, not from the last button the user pressed. Stop still ends the continuation.
- **One batch per Turn.** When a Turn finishes or is stopped, BA starts one new Turn with every queued input, each as its own user message. Messages queued after that Turn starts wait for the next batch. With an empty queue the Session goes idle.
- **Attach to queued Turns yourself.** Poll `GET /api/chat/queue` from its first page while the Session is busy; the cursor only pages through inputs. When `activity.turnId` names a Turn bound to queued inputs, attach once with `joinInputTurn`. It replays from the start of that Turn, so after a reload the whole answer streams again under the same message ID; replace, never append. Attaching only watches. It never starts, restarts, or stops work, so use Stop to end the Turn. A Turn started by `chat` cannot be attached (404), and a dropped `chat` stream is not replayed; reload history after it ends.
- **Stopped queued messages come back to the composer.** Stopping a Turn cancels the inputs it had taken, and saved history keeps none of them. `Chat` remembers that Turn's batch, and after the history reload it puts back the text of every batch message that history lacks, one per line, the way a stopped `chat` send restores its text. The composer is a `textarea` so those lines stay separate; Enter sends and Shift+Enter adds a line. A message that history has was answered before Stop took effect, so it stays answered.
- **Stop without a Turn ID only aborts.** `Chat` stops by `turnId`, reading activity once if it has none yet. When there is still no Turn ID, for example while the first message is creating the Session, it can only abort the chat request. That is not the fenced Stop: BA may cancel the Turn and pause the queue with reason `failed`. Show the paused state and let the user press Resume.
- **Errors pause the queue.** Activity `paused` keeps the waiting inputs until the user presses Resume or sends another message. Inputs marked `uncertain` may have reached the agent before the failure and are never resent automatically; let the user decide.
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
- Queue a message, then press its Send. It joins the running Turn, leaves the queue once the agent reads it, and the current answer takes it into account.
- Queue a message, then press Delete. It never reaches the agent. Queue another and press Stop. The current Turn ends, and the queued message starts the next one.
- Reload while messages are queued. The `queue` block comes back. Reload again while a queued Turn answers. Its batch and the answer so far reappear and keep streaming, with no duplicate messages, and after it ends history matches the screen.
- Retry a submit with the same `requestId` and message; you get the same receipt. Change the text under that `requestId`, and you get `input_idempotency_conflict`.
- While a Tool approval is pending, queued messages stay in the queue and Stop is disabled; a direct `stop` call returns `session_busy`.
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
