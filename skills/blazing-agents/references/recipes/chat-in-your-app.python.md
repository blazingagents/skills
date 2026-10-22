# Add chat to your app: Python code

The Python code for the steps of [Add chat to your app](chat-in-your-app.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Install the packages

```bash
pip install blazing-agents fastapi uvicorn
```

`client.for_user(verified_user_id)` returns the End-user scoped client; it sends the scope on every request, so the calls need no `user_id`. The SDK returns the raw stream bytes. Relay them unchanged and copy the `Location` header on the first Turn. Validate browser IDs with the same patterns the TypeScript handlers use.

For step 3, add three routes to the FastAPI app from step 2; the first lines repeat its client and sign-in hooks.

## Step 2: Add the backend

```python
from typing import Any, Literal, TypedDict

from blazing_agents import (
    APIStatusError,
    AsyncBlazingAgents,
    BlazingAgentsError,
    ToolApprovalDecisionInput,
)
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, TypeAdapter

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


class Approval(BaseModel):
    id: str
    approved: bool
    reason: str | None = None


class Part(BaseModel):
    type: str
    state: str | None = None
    approval: Approval | None = None


PARTS = TypeAdapter(list[Part])


def approval_decisions(message: dict[str, object]) -> list[ToolApprovalDecisionInput]:
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


class ChatBody(BaseModel):
    message: dict[str, object] | None = None
    messages: list[dict[str, object]] | None = None
    messageId: str | None = None
    sessionId: str | None = Field(default=None, pattern=SESSION_ID)
    trigger: Literal["submit-message", "regenerate-message"] = "submit-message"


@app.post("/api/chat")
async def chat(body: ChatBody, user_id: str = Depends(current_user)):
    raw = body.messages if body.messages is not None else ([body.message] if body.message else [])
    approval = (
        body.messages is None
        and body.message is not None
        and body.message.get("role") == "assistant"
    )
    if not raw or (not approval and any(m.get("role") != "user" for m in raw)):
        raise HTTPException(400, "Invalid message.")
    headers = {"cache-control": "no-cache", "x-vercel-ai-ui-message-stream": "v1"}
    scoped = client.for_user(user_id)
    extra: dict[str, Any] = {}
    if body.messageId:
        extra["message_id"] = body.messageId
    try:
        if approval:
            decisions = approval_decisions(raw[0])
            if body.sessionId is None or not decisions:
                raise HTTPException(400, "Invalid approval.")
            stream = await scoped.continue_chat(
                agent_id=agent_for_user(user_id),
                session_id=body.sessionId,
                decisions=decisions,
            )
        elif body.messages is not None:
            if body.sessionId is None:
                raise HTTPException(400, "A batch needs a Session.")
            stream = await scoped.chat(
                agent_id=agent_for_user(user_id),
                session_id=body.sessionId,
                messages=raw,
                **extra,
            )
        elif body.sessionId is None:
            stream = await scoped.chat(
                agent_id=agent_for_user(user_id), message=raw[0], **extra
            )
            headers["location"] = stream.headers["location"]
        else:
            stream = await scoped.chat(
                agent_id=agent_for_user(user_id),
                session_id=body.sessionId,
                message=raw[0],
                trigger=body.trigger,
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
        page = await client.for_user(user_id).sessions.messages(
            agent_id=agent_for_user(user_id), session_id=session_id, limit=200,
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

## Step 3: Add the Session endpoints

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
    }


@app.get("/api/chat/session")
async def session(
    session_id: str = Query(alias="sessionId", pattern=SESSION_ID),
    user_id: str = Depends(current_user),
):
    try:
        page = await client.for_user(user_id).sessions.inputs(
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
        result = await client.for_user(user_id).sessions.submit_input(
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
        result = await client.for_user(user_id).sessions.stop(
            **scope(user_id, body.sessionId), turn_id=body.turnId
        )
    except APIStatusError as exc:
        return JSONResponse({"error": {"code": exc.code}}, status_code=exc.status_code)
    except BlazingAgentsError:
        return JSONResponse({"error": {"code": "upstream_error"}}, status_code=502)
    return result.model_dump(mode="json", by_alias=True)
```
