# Let a chat agent call your backend functions: Python code

The Python code for the steps of [Let a chat agent call your backend functions](backend-functions.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Add the functions inside your chat route, after authenticating the request, so every handler closes over the verified user

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

    extra: dict[str, Any] = {}
    if body.sessionId is not None:
        extra["session_id"] = body.sessionId
    stream = await client.for_user(user_id).chat(
        agent_id=agent_for_user(user_id), message=body.message, functions=functions, **extra
    )
    headers = {"x-vercel-ai-ui-message-stream": "v1"}
    if body.sessionId is None:
        headers["location"] = stream.headers["location"]
    return StreamingResponse(stream, media_type="text/event-stream", headers=headers)
```

## Step 2: Continue with the functions after an approval pause

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
    stream = await client.for_user(session_owner_id).continue_chat(
        agent_id=agent_id,
        session_id=session_id,
        decisions=decisions,
        functions=chat_functions_for(session_owner_id),
    )
    return StreamingResponse(
        stream,
        headers={"x-vercel-ai-ui-message-stream": "v1"},
        media_type="text/event-stream",
    )
```
