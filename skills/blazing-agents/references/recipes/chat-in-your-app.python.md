# Add chat to your app: Python code

The Python code for the steps of [Add chat to your app](chat-in-your-app.md). Read that file first: it explains each step, its decisions, and its gotchas. Step 3, the browser chat, is the same for every backend.

## Step 1: Install the packages

```bash
pip install blazing-agents fastapi uvicorn
```

## Step 2: Add the relay

`AsyncChatRelay` answers the browser's `chat`, `history`, and `steer` requests by the [browser relay contract](https://github.com/blazingagents/typescript-sdk/blob/main/docs/relay-contract.md). For each request it calls your `resolve_context`, which returns a `RelayContext` with the signed-in user and their Agent, or `None`, which the relay answers with `401`. The relay then sends every API request through `client.for_user(user_id)`, and never reads the user or the Agent from the request body. The relay depends on no web framework. `ChatRelay` is the blocking twin for frameworks such as Flask.

```python
import os

from blazing_agents import AsyncBlazingAgents, AsyncChatRelay, RelayContext
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

client = AsyncBlazingAgents()  # reads BLAZING_AGENTS_API_KEY
app = FastAPI()


def signed_in_user_id(request: Request) -> str | None:
    """Your sign-in check. Return the verified user's ID, or None."""
    raise NotImplementedError


async def agent_for(user_id: str) -> str:
    """Each user gets their own Agent, and with it their own Workspace."""
    user = client.for_user(user_id)
    page = await user.agents.list(limit=1)
    if page.data:
        return page.data[0].id
    agent = await user.agents.create(
        name="Chat assistant",
        provider_id=os.environ["BLAZING_AGENTS_PROVIDER_ID"],
        model="openai/gpt-6-luna",
    )
    return agent.id


async def resolve_context(request: Request) -> RelayContext | None:
    user_id = signed_in_user_id(request)
    if user_id is None:
        return None
    return RelayContext(agent_id=await agent_for(user_id), user_id=user_id)


relay = AsyncChatRelay(client=client, resolve_context=resolve_context)


@app.post("/api/chat")
async def chat(request: Request) -> StreamingResponse:
    answer = await relay.handle(request, await request.body())
    return StreamingResponse(answer, status_code=answer.status_code, headers=answer.headers)
```

For backend functions and attribution, set `functions` and `metadata` on the `RelayContext`. For a relay on another origin, add FastAPI's `CORSMiddleware` with `expose_headers=["Location", "X-Request-Id"]`, so the browser can read the new Session ID.
