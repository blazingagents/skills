# Give your agent your own tools through MCP: Python code

The Python code for the steps of [Give your agent your own tools through MCP](external-tools-mcp.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Create the Connection once, on your backend

```python
import os

from blazing_agents import BlazingAgents

client = BlazingAgents()  # reads BLAZING_AGENTS_API_KEY

connection = client.mcp_connections.create(
    name="Customer tools",
    url="https://mcp.example.com/v1",
    auth_type="bearer",
    bearer_token=os.environ["CUSTOMER_MCP_TOKEN"],
)
print(connection.id, connection.status)
```

## Step 3: Test the Connection, attach it to the Agent, and choose what end-user context the server receives

```python
from blazing_agents import BlazingAgents


def attach(agent_id: str, mcp_connection_id: str) -> None:
    client = BlazingAgents()

    test = client.mcp_connections.test(mcp_connection_id)
    if test.error is not None:
        raise RuntimeError(f"{test.error.code}: {test.error.message}")
    if "lookup_customer" not in (test.tool_names or []):
        raise RuntimeError(f"Expected lookup_customer, got {test.tool_names}")

    agent = client.agents.get(agent_id)
    if mcp_connection_id not in agent.mcp_connection_ids:
        client.agents.update(
            agent_id,
            mcp_connection_ids=[*agent.mcp_connection_ids, mcp_connection_id],
        )

    client.agents.update_mcp_attachment(
        agent_id,
        mcp_connection_id,
        forward_user_id=True,
        forwarded_metadata_keys=["plan"],
    )
```

## Step 4: Run a Turn that needs the tool, then read the saved Session to confirm the call

```python
import uuid

from blazing_agents import BlazingAgents


def check_tool_call(agent_id: str, verified_user_id: str) -> None:
    client = BlazingAgents().for_user(verified_user_id)
    with client.chat(
        agent_id=agent_id,
        metadata={"plan": "pro"},
        message={
            "id": str(uuid.uuid4()),
            "role": "user",
            "parts": [{"type": "text", "text": "Look up customer 42 and summarize their account."}],
        },
    ) as stream:
        for _chunk in stream:
            pass  # Drain the stream; in an app, relay the raw bytes to the browser instead.
        session_id = stream.session_id

    page = client.sessions.messages(agent_id=agent_id, session_id=session_id)
    called = any("lookup_customer" in part.type for m in page.data for part in m.parts)
    print(session_id, "MCP tool was called" if called else "MCP tool was not called")
```
