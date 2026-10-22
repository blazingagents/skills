# Require approval before your agent runs a tool: Python code

The Python code for the steps of [Require approval before your agent runs a tool](human-approval.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Set the policies

```python
from blazing_agents import BlazingAgents


def set_policies(agent_id: str, mcp_connection_id: str) -> None:
    client = BlazingAgents()
    client.agents.update(
        agent_id,
        approval_in_chat={
            "default": "full",
            "overrides": [
                {"tool": {"type": "builtin", "name": "bash"}, "decision": "manual"},
                {
                    "tool": {"type": "mcp", "connection_id": mcp_connection_id, "name": "refund_order"},
                    "decision": "manual",
                },
                {
                    "tool": {"type": "mcp", "connection_id": mcp_connection_id, "name": "send_email"},
                    "decision": "auto",
                },
            ],
        },
        approval_in_tasks={
            "default": "deny",
            "overrides": [{"tool": {"type": "builtin", "name": "read"}, "decision": "full"}],
        },
    )
```

## Step 2: After a chat stream ends, list the Session's approvals on your backend and send the pending ones to the reviewer

```python
from blazing_agents import AsyncBlazingAgents
from fastapi import Depends, FastAPI, Query, Request

app = FastAPI()
client = AsyncBlazingAgents()
SESSION_ID = r"^ss_[0-9A-Za-z]{16}$"


def current_user(request: Request) -> str:
    """Your sign-in check. Return your user's ID or raise HTTPException(401)."""
    raise NotImplementedError


def agent_for_user(user_id: str) -> str:
    """Read this user's Agent ID from trusted backend state."""
    raise NotImplementedError


@app.get("/api/tool-approvals")
async def list_pending(
    session_id: str = Query(alias="sessionId", pattern=SESSION_ID),
    user_id: str = Depends(current_user),
) -> dict[str, object]:
    approvals = await client.for_user(user_id).sessions.tool_approvals(
        agent_id=agent_for_user(user_id),
        session_id=session_id,
    )
    pending = [
        {"approvalId": item.approval_id, "tool": item.tool or item.tool_name, "input": item.input}
        for item in approvals.data
        if item.decision == "pending"
    ]
    return {"pending": pending}
```

## Step 3: Send the complete round of decisions in one call

```python
from blazing_agents import AsyncBlazingAgents, ToolApprovalDecisionInput
from fastapi import Depends, FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

app = FastAPI()
client = AsyncBlazingAgents()
SESSION_ID = r"^ss_[0-9A-Za-z]{16}$"


def current_user(request: Request) -> str:
    """Your sign-in check. Return your user's ID or raise HTTPException(401)."""
    raise NotImplementedError


def agent_for_user(user_id: str) -> str:
    """Read this user's Agent ID from trusted backend state."""
    raise NotImplementedError


class Decision(BaseModel):
    approvalId: str
    approved: bool
    reason: str | None = None


class ContinueBody(BaseModel):
    sessionId: str = Field(pattern=SESSION_ID)
    decisions: list[Decision] = Field(min_length=1)


@app.post("/api/tool-approvals/continue")
async def continue_round(
    body: ContinueBody, user_id: str = Depends(current_user)
) -> StreamingResponse:
    decisions: list[ToolApprovalDecisionInput] = []
    for d in body.decisions:
        item: ToolApprovalDecisionInput = {"approval_id": d.approvalId, "approved": d.approved}
        if d.reason is not None:
            item["reason"] = d.reason
        decisions.append(item)
    stream = await client.for_user(user_id).continue_chat(
        agent_id=agent_for_user(user_id),
        session_id=body.sessionId,
        decisions=decisions,
    )
    return StreamingResponse(
        stream,
        headers={"x-vercel-ai-ui-message-stream": "v1"},
        media_type="text/event-stream",
    )
```
