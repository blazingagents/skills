# Python SDK reference

Use this page to call Blazing Agents from a Python backend: install the package, pick a client, run Turns, and find the method for every operation. The supported floor is `blazing-agents` 0.8.0.

For the same surface in TypeScript, read [TypeScript SDK reference](sdk-typescript.md). For end-to-end builds, start from a recipe such as [Add chat to your app](recipes/chat-in-your-app.md).

## Install

The PyPI package is `blazing-agents`. The import name is `blazing_agents`. It needs Python 3.11 or newer.

```bash
pip install "blazing-agents>=0.8.0"
# or
uv add "blazing-agents>=0.8.0"
```

Keep the Tenant API key in `BLAZING_AGENTS_API_KEY` on your backend. It can reach everything in your Tenant, so it never goes to a browser or mobile app.

## Pick a client

- `BlazingAgents` is the synchronous client. Use it in scripts, workers, Django, and Flask.
- `AsyncBlazingAgents` is the asynchronous client. Use it in FastAPI, Starlette, and other asyncio code.

Both expose the same resources and method names. With the async client you `await` each call, use `async with` and `async for`, and close with `aclose()` instead of `close()`. There are no `a`-prefixed method aliases.

## Construct and close

Create one client per process and reuse it. The constructor reads `BLAZING_AGENTS_API_KEY` when you omit `api_key`, and raises `ValueError` when neither is set.

```python
from blazing_agents import BlazingAgents

with BlazingAgents() as client:
    reply = client.completion(
        agent_id="ag_0123456789abcdef",
        prompt="Write a friendly welcome message.",
    )
    print(str(reply), reply.request_id)
```

```python
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from blazing_agents import AsyncBlazingAgents


@asynccontextmanager
async def blazing_agents_client() -> AsyncGenerator[AsyncBlazingAgents]:
    client = AsyncBlazingAgents()
    try:
        yield client
    finally:
        await client.aclose()
```

Constructor options (all keyword-only):

| Option | Default | Use |
| --- | --- | --- |
| `api_key` | `BLAZING_AGENTS_API_KEY` | Tenant API key |
| `base_url` | `https://api.blazingagents.com` | API origin |
| `timeout` | `60.0` seconds | Float, `httpx.Timeout`, or `None` for no timeout. Streams have no read deadline |
| `default_headers` | none | Headers sent on every request |
| `http_client` | SDK-owned | Your own `httpx.Client` (sync) or `httpx.AsyncClient` (async). You keep ownership |
| `on_response` | none | Callback that receives a `ResponseObservation` (`method`, `path`, `status`, `duration_ms`, `request_id`, `client_request_id`) for every response |

`client.with_options(client_request_id="checkout-42")` returns a client that tags every request with your correlation ID. Every method also accepts `extra_headers` and `timeout` per call. The SDK never retries on its own.

## Run Turns: root generation methods

The client itself has five generation methods. Each call runs one metered Turn. Give each call exactly one input: a literal `message` (chat) or `prompt` (completion and object), or a saved Prompt through `prompt_id` with optional `variables`. Every method also accepts `version` to pin an Agent version, and `user_id` plus `metadata` for Attribution to your end user.

| Method | Returns | Use it for |
| --- | --- | --- |
| `chat(...)` | `ChatStream` | A conversation stored as a Session |
| `completion(...)` | `Completion` (a `str` with `request_id`) | Stateless text, buffered |
| `completion_stream(...)` | `CompletionStream` of `str` deltas | Stateless text, streamed. `get_final_text()` returns the whole `Completion` |
| `object(...)` | Your `output_type` instance, or `JsonValue` | Structured output, validated |
| `object_stream(...)` | `ObjectStream` of raw JSON text deltas | Structured output, streamed. `get_final_object()` validates at the end |

### Chat returns raw SSE bytes and a Session ID

`chat()` returns a `ChatStream`. Iterating it yields the server's AI SDK UI message stream as raw SSE `bytes`, exactly as sent. The SDK does not decode it. Relay those bytes to your frontend, where `useChat` from `@ai-sdk/react` reads them.

`stream.session_id` holds the `ss_...` ID before you read the body. Omit `session_id` to start a new Session. Store the returned ID with your user, send it to your frontend, and pass it back as `session_id` to continue that conversation.

```python
from blazing_agents import AsyncBlazingAgents, AsyncChatStream


async def start_chat(
    client: AsyncBlazingAgents,
    *,
    user_id: str,
    message: dict[str, object],
    session_id: str | None,
) -> AsyncChatStream:
    """message is the AI SDK UIMessage from your frontend: {"id", "role", "parts"}."""
    if session_id is None:
        return await client.chat(
            agent_id="ag_0123456789abcdef",
            message=message,
            user_id=user_id,
        )
    return await client.chat(
        agent_id="ag_0123456789abcdef",
        session_id=session_id,
        message=message,
        user_id=user_id,
    )
```

To relay, pass the stream object itself as the body of your framework's streaming response. In FastAPI that is `StreamingResponse(stream, status_code=stream.status_code, media_type="text/event-stream", headers={"x-vercel-ai-ui-message-stream": "v1", "x-session-id": stream.session_id})`. The header name for the Session ID is your choice. The [FastAPI example](https://github.com/blazingagents/examples/tree/main/vite-fastapi-ai-sdk) shows the full endpoint.

Outside a web request, iterate the chunks yourself:

```python
from blazing_agents import BlazingAgents

with BlazingAgents() as client:
    with client.chat(
        agent_id="ag_0123456789abcdef",
        message={
            "id": "msg-1",
            "role": "user",
            "parts": [{"type": "text", "text": "Hello"}],
        },
    ) as stream:
        print("Session:", stream.session_id)
        for chunk in stream:
            # Raw SSE bytes. Forward, log, or store them as you need.
            print(chunk.decode(), end="")
```

Chat rules the SDK enforces before sending:

- `version` is allowed only when you start a Session, not when you pass `session_id`.
- `trigger="regenerate-message"` needs `session_id`. It can target a `message_id`.
- `variables` needs `prompt_id`.

### Structured output

Pass exactly one of `output_type` (any Pydantic-compatible type) or `json_schema` (a raw schema dict). With `output_type` the SDK derives the schema and returns a validated instance. With `json_schema` you get the decoded JSON without validation.

```python
from pydantic import BaseModel

from blazing_agents import BlazingAgents


class Summary(BaseModel):
    title: str
    risks: list[str]


with BlazingAgents() as client:
    summary = client.object(
        agent_id="ag_0123456789abcdef",
        prompt="Summarize the release plan.",
        output_type=Summary,
    )
    print(summary.title, summary.risks)
```

See [Get structured output](recipes/structured-output.md) for streaming and failure handling.

### Stream ownership

Every chat, completion, and object stream has exactly one reader. Reading to the end closes it. To stop early, use `with` (or `async with`) or call `close()` (`aclose()` on async). Iterating twice raises `StreamError`.

## Agent-scoped resources

`client.agent(agent_id)` returns a scoped handle without a network request. Its only member is `skills`, so every Skill operation goes through `client.agent(agent_id).skills`.

```python
from blazing_agents import BlazingAgents

with BlazingAgents() as client:
    skills = client.agent("ag_0123456789abcdef").skills
    for skill in skills.iter():
        print(skill.id, skill.name)
```

## Operation map

Signatures below drop `extra_headers` and `timeout`, which every method accepts. Arguments are keyword-only except leading IDs shown before `*`. `=...` marks an optional argument. The async client has the same table; `await` each call, and use `async for` on `iter*` methods without awaiting them.

### `client.agents`

| Method | Returns |
| --- | --- |
| `create(*, name, provider_id=..., model=..., workspace_id=..., thinking_level=..., tools=..., instructions=..., memory_injection_enabled=..., auto_compaction=..., compaction_reserve_tokens=..., approval_in_chat=..., approval_in_tasks=..., user_id=..., metadata=..., mcp_connection_ids=...)` | `Agent` |
| `list(*, user_id=..., workspace_id=...)` | `Agents` (`.agents`, not paginated) |
| `get(agent_id)` | `Agent` |
| `update(agent_id, *, <create fields except user_id>)` | `Agent` (new version) |
| `delete(agent_id, *, include_artifacts: bool)` | `None` |
| `disable(agent_id)` / `enable(agent_id)` | `Agent` |
| `upload_avatar(agent_id, file, *, filename=None, content_type=None)` | `Agent` |
| `remove_avatar(agent_id)` | `Agent` |
| `list_versions(agent_id, *, cursor=..., limit=...)` | `AgentVersionsPage` |
| `iter_versions(agent_id, *, cursor=..., limit=...)` | `Iterator[AgentVersion]` |
| `get_version(agent_id, version)` | `AgentVersion` |
| `restore_version(agent_id, version)` | `Agent` |
| `list_mcp_attachments(agent_id)` | `McpAttachments` (`.mcp_attachments`) |
| `update_mcp_attachment(agent_id, mcp_connection_id, *, forward_user_id=..., forwarded_metadata_keys=...)` | `McpAttachment` |

`provider_id` and `model` go together on create. On update, `model` alone changes the model and `provider_id` needs `model`. `tools` is a list of `"workspace"`, `"write_todos"`, `"memory"`.

### `client.agent(agent_id).skills`

| Method | Returns |
| --- | --- |
| `create(*, path="SKILL.md", content)` | `SkillDetail` |
| `upload(*, archive_type, file, filename=None)` | `SkillDetail` (`archive_type`: `"zip"`, `"tar"`, `"tar.gz"`) |
| `list(*, cursor=..., limit=...)` | `SkillsPage` |
| `iter(*, cursor=..., limit=...)` | `Iterator[Skill]` |
| `get(*, skill_id)` | `SkillDetail` |
| `delete(*, skill_id)` | `None` |
| `read_file(*, skill_id, path)` | `bytes` |
| `replace_file(*, skill_id, path, content: bytes)` | `SkillDetail` |
| `delete_file(*, skill_id, path)` | `SkillDetail` |
| `copy(*, skill_id, destination_agent_ids)` | `list[SkillCopyResult]` |

### `client.sessions`

| Method | Returns |
| --- | --- |
| `list(*, agent_id, user_id=..., cursor=..., limit=...)` | `SessionsPage` |
| `iter(*, agent_id, user_id=..., cursor=..., limit=...)` | `Iterator[Session]` |
| `list_latest(*, user_id=..., cursor=..., limit=..., by_agent=None)` | `LatestSessionsPage` |
| `messages(*, agent_id, session_id, cursor=..., after=..., limit=...)` | `SessionMessagesPage` |
| `tool_approvals(*, agent_id, session_id)` | `ToolApprovals` (`.data`) |
| `decide_tool_approval(*, agent_id, session_id, approval_id, approved, reason=...)` | `ToolApprovalDecision` |
| `join_tool_approval_continuation(*, agent_id, session_id, continuation_id)` | `ByteStream` (same SSE format as `chat()`) |
| `delete(*, agent_id, session_id, delete_artifacts: bool)` | `None` |

Start and continue Sessions with `client.chat()`, not through this resource. `list_latest(by_agent=True)` returns at most one Session per Agent, which suits an inbox view.

### `client.tasks`

| Method | Returns |
| --- | --- |
| `create(*, agent_id, name, prompt, agent_version=..., schedule=..., enabled=..., submit=..., user_id=..., metadata=...)` | `TaskCreateResponse` |
| `list(*, agent_id=..., user_id=..., cursor=..., limit=...)` | `TasksPage` |
| `iter(*, agent_id=..., user_id=..., cursor=..., limit=...)` | `Iterator[TaskListItem]` |
| `get(task_id)` | `Task` |
| `update(task_id, *, agent_version=..., name=..., prompt=..., schedule=..., enabled=..., metadata=...)` | `Task` |
| `delete(task_id)` | `None` |
| `submit(task_id, *, idempotency_key=...)` | `TaskRunSubmission` |
| `list_runs(task_id, *, cursor=..., limit=...)` | `TaskRunsPage` |
| `iter_runs(task_id, *, cursor=..., limit=...)` | `Iterator[TaskRun]` |
| `get_run(task_id, run_id)` | `TaskRun` |
| `run_messages(task_id, run_id, *, cursor=..., after=..., limit=...)` | `TaskRunMessagesPage` |
| `cancel_run(task_id, run_id)` | `None` |

`schedule` is `{"kind": "once", "config": {"at": "<ISO datetime with offset>"}}`, `{"kind": "interval", "config": {"every_ms": 60000}}` (at least 60000), or `{"kind": "cron", "config": {"expression": "0 9 * * 1", "timezone": "Pacific/Auckland"}}`. Pass `schedule=None` on update to remove it.

### `client.workspaces`

| Method | Returns |
| --- | --- |
| `create(*, name=..., user_id=..., metadata=..., network_policy=...)` | `Workspace` |
| `list(*, cursor=..., limit=..., user_id=...)` | `WorkspacesPage` |
| `iter(*, cursor=..., limit=..., user_id=...)` | `Iterator[Workspace]` |
| `get(*, workspace_id)` | `Workspace` |
| `update(*, workspace_id, name=..., metadata=..., network_policy=...)` | `Workspace` |
| `delete(*, workspace_id)` | `"completed"` or `"pending"` |

### `client.providers`

| Method | Returns |
| --- | --- |
| `create(*, name, provider_type, api_key, base_url=...)` | `Provider` |
| `list()` | `Providers` (`.providers`) |
| `get(provider_id)` | `Provider` |
| `list_models(provider_id)` | `ProviderModels` (`.models`) |
| `get_thinking_levels(provider_id, *, model)` | `ThinkingLevels` |
| `update(provider_id, *, name)` | `Provider` |
| `delete(provider_id, *, confirm_version_invalidation=False)` | `None` |

`provider_type` is `"openai"`, `"anthropic"`, `"openrouter"`, `"google"`, `"vercel_ai_gateway"`, or `"custom"` (needs `base_url`).

### `client.mcp_connections`

| Method | Returns |
| --- | --- |
| `create(*, name, url, auth_type, bearer_token=..., client_id=..., client_secret=..., scope=...)` | `McpConnection` |
| `list()` | `McpConnections` (`.mcp_connections`) |
| `get(mcp_connection_id)` | `McpConnection` |
| `update(mcp_connection_id, *, name)` | `McpConnection` |
| `delete(mcp_connection_id)` | `None` |
| `test(mcp_connection_id)` | `McpConnectionTestResult` |
| `connect(mcp_connection_id)` | `McpConnectionAuthorization` (OAuth sign-in URL) |
| `reconnect(mcp_connection_id, *, url, auth_type, bearer_token=..., client_id=..., client_secret=..., scope=...)` | `McpConnectionReconnectResult` |

`auth_type` is `"none"`, `"bearer"` (needs `bearer_token`), `"oauth_client_credentials"` (needs `client_id` and `client_secret`), or `"oauth_authorization_code"`. Attach a connection to an Agent through `agents.create/update(mcp_connection_ids=[...])`.

### `client.memories`

| Method | Returns |
| --- | --- |
| `create(*, agent_id, text, user_id=...)` | `MemoryResponse` |
| `list(*, agent_id, user_id=..., search=..., cursor=..., limit=...)` | `MemoriesPage` |
| `iter(*, agent_id, user_id=..., search=..., cursor=..., limit=...)` | `Iterator[Memory]` |
| `get(*, agent_id, memory_id)` | `MemoryResponse` |
| `update(*, agent_id, memory_id, text)` | `MemoryResponse` |
| `delete(*, agent_id, memory_id)` | `None` |

### `client.prompts`

| Method | Returns |
| --- | --- |
| `create(*, name, template, agent_id=..., user_id=..., metadata=...)` | `Prompt` |
| `list(*, agent_id=..., user_id=...)` | `Prompts` (`.prompts`, not paginated) |
| `get(*, prompt_id)` | `Prompt` |
| `update(*, prompt_id, agent_id=..., name=..., template=..., metadata=...)` | `Prompt` |
| `delete(*, prompt_id)` | `None` |

Run a saved Prompt with `client.chat(prompt_id=..., variables={...})` or the other generation methods.

### `client.artifacts`

| Method | Returns |
| --- | --- |
| `list(*, agent_id=..., session_id=..., cursor=...)` | `ArtifactsPage` |
| `iter(*, agent_id=..., session_id=..., cursor=...)` | `Iterator[Artifact]` |
| `get(*, artifact_id)` | `Artifact` |
| `create_download_url(*, artifact_id)` | `ArtifactDownloadUrl` (short-lived link) |
| `delete(*, artifact_id)` | `None` |

### `client.chat_connections`

| Method | Returns |
| --- | --- |
| `create(*, platform, credentials, name, agent_id, configuration=..., enabled=...)` | `ChatConnection` |
| `list()` | `ChatConnections` (`.chat_connections`) |
| `get(chat_connection_id)` | `ChatConnection` |
| `update(chat_connection_id, *, name=..., configuration=...)` | `ChatConnection` |
| `rotate_credentials(chat_connection_id, *, platform, credentials)` | `ChatConnection` |
| `check_health(chat_connection_id)` | `ChatConnection` |
| `enable(chat_connection_id)` / `disable(chat_connection_id)` | `ChatConnection` |
| `delete(chat_connection_id)` | `None` |

`platform` is `"slack"` or `"telegram"`. See [Put your agent in Slack or Telegram](recipes/slack-and-telegram.md).

### `client.usage` and `client.tenant`

| Method | Returns |
| --- | --- |
| `usage.overview(*, from_=..., to=..., limit=...)` | `UsageOverview` (totals, daily rows, top breakdowns; `limit` 1 to 20, default 5) |
| `usage.get(*, from_=..., to=..., agent_id=..., session_id=..., user_id=..., group_by=..., limit=...)` | `Usage` |
| `usage.get_for_agent(agent_id, *, from_=..., to=..., session_id=..., user_id=..., group_by=..., limit=...)` | `Usage` |
| `tenant.get()` | `TenantSettings` |
| `tenant.update(*, name=..., quota=...)` | `TenantSettings` |

`group_by` is `"day"`, `"agent"`, `"model"`, `"session"`, or `"user"`. `from_` has a trailing underscore because `from` is a Python keyword.

## Partial updates: omit to keep, `None` to clear

Every optional argument defaults to an internal `OMITTED` sentinel. An omitted argument is not sent, so the server keeps the current value (or its default on create). Passing `None` sends JSON `null`, which clears a nullable field. Leave arguments out to omit them; the sentinel is private and you never import it.

```python
from blazing_agents import BlazingAgents

with BlazingAgents() as client:
    # Changes only the instructions. Every other field keeps its value.
    client.agents.update(
        "ag_0123456789abcdef",
        instructions="Answer in two sentences.",
    )
    # None clears a nullable field: back to the Provider's default thinking level.
    client.agents.update("ag_0123456789abcdef", thinking_level=None)
```

- Supplied lists and dicts replace the old value completely. `tools`, `mcp_connection_ids`, `metadata`, and approval policies are not merged.
- `agents.update()` with no fields raises `ValueError` before any request.
- To forward optional values from your own input, build a `dict` of only the keys you have and pass it with `**`.

## Pagination

Paginated `list*` methods return one page with `data` and `next_cursor` (`None` on the last page). Pass `next_cursor` back as `cursor` for the next page. The matching `iter*` method walks every page lazily and sends no request until you start iterating.

```python
from blazing_agents import BlazingAgents

with BlazingAgents() as client:
    for session in client.sessions.iter(agent_id="ag_0123456789abcdef", limit=50):
        print(session.id)

    page = client.tasks.list(limit=20)
    while True:
        for task in page.data:
            print(task.id, task.name)
        if page.next_cursor is None:
            break
        page = client.tasks.list(limit=20, cursor=page.next_cursor)
```

```python
from blazing_agents import AsyncBlazingAgents


async def print_memories(client: AsyncBlazingAgents, user_id: str) -> None:
    # Async iter* methods are not awaited: use async for directly.
    async for memory in client.memories.iter(
        agent_id="ag_0123456789abcdef", user_id=user_id
    ):
        print(memory.id, memory.text)
```

`agents.list()`, `providers.list()`, `prompts.list()`, `mcp_connections.list()`, and `chat_connections.list()` return every item in one response. `sessions.messages()` and `tasks.run_messages()` also return `latest_cursor`; pass it as `after` later to fetch only newer messages. Do not pass `cursor` and `after` together.

## Errors

All SDK exceptions inherit from `BlazingAgentsError`. Import them from `blazing_agents`.

| Class | Raised when | Useful attributes |
| --- | --- | --- |
| `APIStatusError` | The API returns an error status | `status_code`, `code`, `details`, `param`, `request_id`, `retry_after`, `headers`, `response_body` |
| `APIConnectionError` | The network fails before a full response | |
| `APITimeoutError` | The request times out (subclass of `APIConnectionError`) | |
| `StreamError` | A stream fails after headers arrive, is read twice, or ends early | `status_code`, `request_id`, `retry_after`, `headers` |
| `ObjectTruncationError` | Structured output ended with incomplete JSON (subclass of `StreamError`) | `json_error` |
| `ObjectJSONDecodeError` | Structured output is invalid JSON (subclass of `StreamError`) | `json_error` |
| `ObjectValidationError` | Structured output does not match `output_type` (subclass of `StreamError`) | `validation_error` |

The SDK raises plain `ValueError` or `TypeError` for invalid arguments before sending, for example both `message` and `prompt_id`, or `provider_id` without `model`.

```python
from blazing_agents import (
    APIConnectionError,
    APIStatusError,
    BlazingAgents,
    StreamError,
)

with BlazingAgents() as client:
    try:
        agent = client.agents.get("ag_0123456789abcdef")
        print(agent.name)
    except APIStatusError as error:
        # Branch on the stable code, not the message.
        if error.code == "not_found":
            print("No such Agent")
        else:
            print(error.status_code, error.code, error.request_id, error.retry_after)
    except StreamError as error:
        print("Stream failed", error.request_id)
    except APIConnectionError:
        print("Could not reach Blazing Agents")
```

Response models carry the server request ID in `_request_id`. `Completion` and stream objects expose it as `request_id`. Include it when you contact support.

## Gotchas

- Passing `session_id=None` to `client.chat()` fails type checks and at runtime. Branch and leave `session_id` out when you start a Session.
- Reading `ChatStream` into memory before replying breaks streaming for your user. Pass the stream object to your framework's streaming response.
- Losing `stream.session_id` starts a fresh Session on every message. Save it with your user before you return the response.
- Awaiting an async `iter*` call raises a `TypeError`. Use `async for` directly on the call.
- Forgetting to close the client leaks connections. Use `with` / `async with`, or call `close()` / `await aclose()` at shutdown.
- Responses are Pydantic v2 models with snake_case fields. Unknown new server fields stay in `model_extra`, so upgrades do not break parsing.

## Go deeper

- [Python SDK overview](https://docs.blazingagents.com/sdk/python)
- [Python client, generation, and errors](https://docs.blazingagents.com/sdk/python/client)
- [Python Agents](https://docs.blazingagents.com/sdk/python/agents), [Sessions](https://docs.blazingagents.com/sdk/python/sessions), [Skills](https://docs.blazingagents.com/sdk/python/skills), [Tasks](https://docs.blazingagents.com/sdk/python/tasks)
- [Error codes](https://docs.blazingagents.com/api-reference/protocols/errors)
- [Connect Blazing Agents to your app](https://docs.blazingagents.com/getting-started/connect-your-app)
- [Vite + FastAPI example](https://github.com/blazingagents/examples/tree/main/vite-fastapi-ai-sdk)
