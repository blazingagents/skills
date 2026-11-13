# Add chat to your app: Python code

The Python code for the steps of [Add chat to your app](chat-in-your-app.md). Read that file first: it explains each step, its decisions, and its gotchas. Step 3, the React chat, is the same for every backend.

## Step 1: Install the packages

```bash
pip install blazing-agents fastapi uvicorn
```

The Python SDK has no relay helper, so the backend implements the [browser relay contract](https://github.com/blazingagents/typescript-sdk/blob/main/docs/relay-contract.md) that `useBlazingAgentsChat` speaks. Every request is a JSON `POST` to one route, and its `op` selects the operation:

| `op` | Body | Scoped client call | Answer |
| --- | --- | --- | --- |
| `chat` | `message`, and optional `sessionId`, `messageId`, `trigger` | `chat()` for a user message, `continue_chat()` for an assistant message that answers an approval round | The stream, with the `Location` header on a new Session |
| `history` | `sessionId`, optional `cursor` | `sessions.messages(limit=200)` | `200` with `{"data": [...], "nextCursor": ...}`: one page, forwarded as it is |
| `steer` | `sessionId`, `requestId`, `message` | `sessions.submit_input()` | `202` with `{"state": ...}` |

`client.for_user(user_id)` returns the End-user scoped client, which sends the scope on every request. Every error body is `{"error": {"code": ..., "message": ...}}`, with the API's status and code when the API refused the call. The browser reads the remaining history pages itself and validates the messages, so the relay forwards one page without a paging loop.

## Step 2: Add the relay

```python
import os
from typing import Annotated, Any, Literal, TypedDict

from blazing_agents import (
    APIConnectionError,
    APIStatusError,
    AsyncBlazingAgents,
    AsyncUserClient,
    StreamError,
    ToolApprovalDecisionInput,
)
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import AfterValidator, BaseModel, Field, TypeAdapter, ValidationError

client = AsyncBlazingAgents()  # reads BLAZING_AGENTS_API_KEY
app = FastAPI()
SESSION_ID = r"^ss_[0-9A-Za-z]{16}$"


def signed_in_user_id(request: Request) -> str | None:
    """Your sign-in check. Return the verified user's ID, or None."""
    raise NotImplementedError


async def agent_for(user: AsyncUserClient) -> str:
    """Each user gets their own Agent, and with it their own Workspace."""
    page = await user.agents.list(limit=1)
    if page.data:
        return page.data[0].id
    agent = await user.agents.create(
        name="Chat assistant",
        provider_id=os.environ["BLAZING_AGENTS_PROVIDER_ID"],
        model="openai/gpt-6-luna",
    )
    return agent.id


def not_dot_segment(value: str) -> str:
    if value in (".", ".."):
        raise ValueError("requestId must not be '.' or '..'")
    return value


class ChatOp(BaseModel):
    op: Literal["chat"]
    message: dict[str, Any]
    messageId: str | None = Field(default=None, min_length=1)
    sessionId: str | None = Field(default=None, pattern=SESSION_ID)
    trigger: Literal["submit-message", "regenerate-message"] = "submit-message"


class HistoryOp(BaseModel):
    op: Literal["history"]
    sessionId: str = Field(pattern=SESSION_ID)
    cursor: str | None = Field(default=None, min_length=1)


class SteerOp(BaseModel):
    op: Literal["steer"]
    sessionId: str = Field(pattern=SESSION_ID)
    requestId: Annotated[str, Field(min_length=1, max_length=128), AfterValidator(not_dot_segment)]
    message: dict[str, Any]


RELAY_REQUEST = TypeAdapter(Annotated[ChatOp | HistoryOp | SteerOp, Field(discriminator="op")])


class Approval(BaseModel):
    id: str
    approved: bool
    reason: str | None = None


class Part(BaseModel):
    type: str
    state: str | None = None
    approval: Approval | None = None


PARTS = TypeAdapter(list[Part])


class HistoryPagination(TypedDict, total=False):
    cursor: str


def error(status: int, code: str, message: str, request_id: str | None = None) -> JSONResponse:
    headers = {"x-request-id": request_id} if request_id else None
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


def approval_decisions(message: dict[str, Any]) -> list[ToolApprovalDecisionInput]:
    """The round's decisions: answered Tool parts after the last step-start."""
    parts = PARTS.validate_python(message.get("parts", []))
    starts = [i for i, part in enumerate(parts) if part.type == "step-start"]
    decisions: list[ToolApprovalDecisionInput] = []
    for part in parts[starts[-1] + 1 if starts else 0 :]:
        if part.state != "approval-responded" or part.approval is None:
            continue
        item: ToolApprovalDecisionInput = {
            "approval_id": part.approval.id,
            "approved": part.approval.approved,
        }
        if part.approval.reason is not None:
            item["reason"] = part.approval.reason
        decisions.append(item)
    return decisions


async def relay_chat(user: AsyncUserClient, agent_id: str, body: ChatOp) -> Response:
    role = body.message.get("role")
    if role == "assistant":
        decisions = approval_decisions(body.message)
        if body.sessionId is None or not decisions:
            return error(400, "invalid_request", "Invalid approval.")
        stream = await user.continue_chat(
            agent_id=agent_id, session_id=body.sessionId, decisions=decisions
        )
    elif role == "user":
        extra: dict[str, Any] = {}
        if body.messageId is not None:
            extra["message_id"] = body.messageId
        if body.sessionId is not None:
            extra["session_id"] = body.sessionId
            extra["trigger"] = body.trigger
        stream = await user.chat(agent_id=agent_id, message=body.message, **extra)
    else:
        return error(400, "invalid_request", "Invalid chat message.")
    headers = {"cache-control": "no-cache", "x-vercel-ai-ui-message-stream": "v1"}
    if location := stream.headers.get("location"):
        headers["location"] = location
    if stream.request_id:
        headers["x-request-id"] = stream.request_id
    return StreamingResponse(
        stream, status_code=stream.status_code, media_type="text/event-stream", headers=headers
    )


async def relay_history(user: AsyncUserClient, agent_id: str, body: HistoryOp) -> Response:
    pagination: HistoryPagination = {} if body.cursor is None else {"cursor": body.cursor}
    page = await user.sessions.messages(
        agent_id=agent_id, session_id=body.sessionId, limit=200, **pagination
    )
    data = [m.model_dump(mode="json", by_alias=True, exclude_unset=True) for m in page.data]
    return JSONResponse({"data": data, "nextCursor": page.next_cursor})


async def relay_steer(user: AsyncUserClient, agent_id: str, body: SteerOp) -> Response:
    if body.message.get("role") != "user":
        return error(400, "invalid_request", "Steering requires a user message.")
    receipt = await user.sessions.submit_input(
        agent_id=agent_id,
        session_id=body.sessionId,
        request_id=body.requestId,
        message=body.message,
    )
    return JSONResponse({"state": receipt.data.state}, status_code=202)


@app.post("/api/chat")
async def relay(request: Request) -> Response:
    user_id = signed_in_user_id(request)
    if user_id is None:
        return error(401, "unauthorized", "Authentication required.")
    try:
        body = RELAY_REQUEST.validate_json(await request.body())
    except ValidationError:
        return error(400, "invalid_request", "Invalid request body.")
    user = client.for_user(user_id)
    try:
        agent_id = await agent_for(user)
        match body:
            case ChatOp():
                return await relay_chat(user, agent_id, body)
            case HistoryOp():
                return await relay_history(user, agent_id, body)
            case SteerOp():
                return await relay_steer(user, agent_id, body)
    except APIStatusError as exc:
        return error(exc.status_code, exc.code, str(exc), exc.request_id)
    except StreamError as exc:
        return error(502, "stream_error", str(exc), exc.request_id)
    except APIConnectionError:
        return error(502, "network_error", "Unable to reach Blazing Agents.")
```

Pydantic ignores body keys it does not know, as the contract requires. For a relay on another origin, add FastAPI's `CORSMiddleware` with `expose_headers=["Location", "X-Request-Id"]`, so the browser can read the new Session ID.
