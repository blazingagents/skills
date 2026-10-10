# Let a chat agent call your backend functions

At the end, your chat agent can call functions that run inside your own backend with your database and credentials, typed inputs, and the signed-in user's identity, and approvals resume cleanly.

## When to use this

The agent needs a tool that only your backend can provide (reading the signed-in user's orders, creating a ticket in your own system, charging a card), and it is needed only in interactive chat. For tools that Tasks, stateless generation, or Slack/Telegram must also reach, or tools on a third-party server, use [MCP](external-tools-mcp.md) instead.

## How it works

You pass a map of named functions on a single `chat()` call. Blazing Agents sends the model only each function's name, description, and input schema. When the model calls one, the SDK hands the call back to your backend process, validates the input, runs your handler, and submits its JSON result; the browser stream stays clean of those private events. The functions belong to that request and are never saved on the Agent, so you attach them again on every chat call and on `continueChat()` after an approval pause. Your code and credentials never leave your backend.

## Build it

1. Add the functions inside your chat route, after authenticating the request, so every handler closes over the verified user. Scope the call with `forUser` (TypeScript) or `X-BA-User-Id` (Python) as in [chat in your app](chat-in-your-app.md). Read the user's Agent ID from trusted backend state, never from the request, and validate the browser's `sessionId` before it reaches the SDK.

```ts
import { BlazingAgents, defineFunction, type ChatFunctions, type UIMessage } from "@blazingagents/sdk";
import { sessionIdSchema } from "@blazingagents/sdk/contracts";
import { z } from "zod";

declare function authenticate(request: Request): Promise<{ id: string; agentId: string } | null>;
declare function findOrder(
  userId: string,
  orderId: string,
  options: { signal: AbortSignal; idempotencyKey: string },
): Promise<{ status: string; totalCents: number } | null>;

const client = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });
const chatBody = z.object({
  message: z.custom<UIMessage>(),
  sessionId: sessionIdSchema.optional(),
});

export async function POST(request: Request): Promise<Response> {
  const user = await authenticate(request);
  if (!user) return new Response("Sign in first.", { status: 401 });
  const body = chatBody.parse(await request.json());

  const functions: ChatFunctions = {
    orderLookup: defineFunction({
      description: "Look up one of the signed-in user's orders by ID.",
      inputSchema: z.object({ orderId: z.string() }),
      execute: async ({ orderId }, { idempotencyKey, signal }) => {
        // findOrder queries only this user's rows. signal stops the work at
        // the call's deadline; idempotencyKey names this one execution.
        const order = await findOrder(user.id, orderId, { signal, idempotencyKey });
        return order ?? { found: false };
      },
    }),
  };

  const input = { agentId: user.agentId, message: body.message, functions };
  const result = body.sessionId
    ? await client.forUser(user.id).chat({ ...input, sessionId: body.sessionId })
    : await client.forUser(user.id).chat(input);
  return result.toResponse();
}
```

```python
from typing import Any

from blazing_agents import AsyncBlazingAgents, FunctionContext, define_function
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

app = FastAPI()
client = AsyncBlazingAgents()  # reads BLAZING_AGENTS_API_KEY
SESSION_ID = r"^ss_[0-9A-Za-z]{16}$"


def current_user(request: Request) -> str:
    """Your sign-in check. Return the verified user ID or raise HTTPException(401)."""
    raise NotImplementedError


def agent_for_user(user_id: str) -> str:
    """Read this user's Agent ID from trusted backend state."""
    raise NotImplementedError


async def find_order(user_id: str, order_id: str) -> dict[str, Any] | None:
    """Your database lookup, scoped to this user."""
    raise NotImplementedError


class OrderInput(BaseModel):
    order_id: str


class ChatBody(BaseModel):
    message: dict[str, Any]
    sessionId: str | None = Field(default=None, pattern=SESSION_ID)


@app.post("/api/chat")
async def chat(body: ChatBody, user_id: str = Depends(current_user)):
    async def order_lookup(value: OrderInput, context: FunctionContext) -> dict[str, Any]:
        # Queries only this user's rows. An async handler is cancelled at the
        # call's deadline or when the stream closes (a synchronous handler
        # checks context.cancelled); context.idempotency_key names this one
        # execution.
        order = await find_order(user_id, value.order_id)
        return order or {"found": False}

    functions = {
        "orderLookup": define_function(
            description="Look up one of the signed-in user's orders by ID.",
            input_schema=OrderInput,
            execute=order_lookup,
        ),
    }

    extra: dict[str, Any] = {"extra_headers": {"X-BA-User-Id": user_id}}
    if body.sessionId is not None:
        extra["session_id"] = body.sessionId
    stream = await client.chat(
        agent_id=agent_for_user(user_id), message=body.message, functions=functions, **extra
    )
    headers = {"x-vercel-ai-ui-message-stream": "v1"}
    if body.sessionId is None:
        headers["location"] = stream.headers["location"]
    return StreamingResponse(stream, media_type="text/event-stream", headers=headers)
```

2. Continue with the functions after an approval pause. When the chat attached functions, the continuation needs them too: the round's decisions and the handlers arrive together on one `continueChat` (`continue_chat` in Python) call, which records the complete round and streams the rest of the Turn. In the decision route from [human approval](human-approval.md), which authenticates the reviewer and checks their access to the Session first, collect the whole round's decisions and rebuild the handlers the same way, closing over the Session owner's verified identity.

```ts
import type { BlazingAgents, ChatFunctions, ToolApprovalDecision } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const sessionOwnerId: string; // the Session's owner, from your records
declare function chatFunctionsFor(userId: string): ChatFunctions; // the map from step 1

declare const agentId: string;
declare const sessionId: string;
declare const decisions: ToolApprovalDecision[]; // every approval in the round

export async function continueAfterDecisions(): Promise<Response> {
  const continued = await client.forUser(sessionOwnerId).continueChat({
    agentId,
    sessionId,
    decisions,
    functions: chatFunctionsFor(sessionOwnerId),
  });
  return continued.toResponse();
}
```

```python
from blazing_agents import AsyncBlazingAgents, ChatFunction, ToolApprovalDecisionInput
from fastapi.responses import StreamingResponse

client = AsyncBlazingAgents()


def chat_functions_for(user_id: str) -> dict[str, ChatFunction]:
    """The same map as step 1, built for the Session's owner."""
    raise NotImplementedError


async def continue_after_decisions(
    agent_id: str,
    session_id: str,
    decisions: list[ToolApprovalDecisionInput],
    session_owner_id: str,
) -> StreamingResponse:
    stream = await client.continue_chat(
        agent_id=agent_id,
        session_id=session_id,
        decisions=decisions,
        functions=chat_functions_for(session_owner_id),
        extra_headers={"X-BA-User-Id": session_owner_id},
    )
    return StreamingResponse(
        stream,
        headers={"x-vercel-ai-ui-message-stream": "v1"},
        media_type="text/event-stream",
    )
```

## Gotchas

- Functions travel only on Turns your backend starts with `chat()` or `continueChat()`: never on Tasks (including scheduled), stateless `completion`/`object`, or Slack/Telegram Turns. Use [MCP](external-tools-mcp.md) for those.
- Nothing is saved on the Agent. Send `functions` on every chat call and rebuild the map per request so handlers capture that request's verified user.
- Never trust a user ID the model supplies as an argument; build handlers after authenticating and query with the verified ID.
- Backend functions follow `approvalInChat.default`; per-tool `overrides` name built-in and MCP tools only.
- Messages that waited while the Session was busy go out through your own `chat()` calls, so attach the same `functions` map to each one, including a multi-message `chat({ messages: [...] })`. See [chat in your app](chat-in-your-app.md).
- The saved schema wins on the continuation. A missing handler or invalid input reaches the agent as a tool error, so keep the continued handlers compatible with what chat advertised.
- Each call has a 60-second deadline, including claim time. Cancellation is cooperative (pass `signal`, or check `cancelled` in a synchronous Python handler) and cannot undo a side effect that already happened.
- The idempotency key marks one execution. A user resend gets a fresh key, so payments and other business operations need your own stable transaction ID.
- The SDK retries transient claim and result failures without rerunning your handler. If the connection drops after a side effect, the outcome can be unknown; check your own records before repeating it.
- Return plain JSON. Convert dates and model instances first (Pydantic `model_dump(mode="json")`). Handler exceptions and invalid inputs or results reach the agent as sanitized tool errors; your exception details stay in your logs.
- Keep reading the stream. The SDK dispatches calls as you consume events; Python delays new calls if iteration pauses.
- Function names start with a letter and allow up to 64 letters, digits, `_`, or `-`. Built-in tool names and the `mcp__` prefix are reserved.

## Check it works

- Ask the agent something only the function can answer ("What is the status of my order ORD-1234?"). The answer contains your live data, and your backend logs show the handler ran.
- Ask for an order that belongs to another user. The handler still queries by the verified ID and the agent reports the order as missing.
- Set `approvalInChat.default` to `"manual"`, ask again, and record the round's decisions. `continueChat` with the functions streams the continued answer.
- Send the same message twice. Each run logs a different `idempotencyKey`; use that to confirm your downstream dedupe key is your own, not this one.

## Go deeper

- [Backend functions](https://docs.blazingagents.com/agents/tools/backend-functions)
- [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals)
- `defineFunction` and `continueChat` in the [TypeScript client](https://docs.blazingagents.com/sdk/typescript/client#define-function)
- `define_function` and `continue_chat` in the [Python client](https://docs.blazingagents.com/sdk/python/client#define-function)
- [Human approval](human-approval.md) for the full decide-and-resume flow
