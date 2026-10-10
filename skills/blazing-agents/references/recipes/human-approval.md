# Require approval before your agent runs a tool

At the end, risky tool calls pause for a person in your app, who sees the tool and its arguments and approves or denies it, and the agent then carries on in the same chat.

## When to use this

Your agent can run shell commands, send email, change records, or call any tool you want a person to sign off first, or you want some tools blocked outright. If you instead want Slack or Telegram approval buttons, those are built in; read [slack-and-telegram.md](slack-and-telegram.md).

## How it works

Each Agent has two approval policies: `approvalInChat` for chat and stateless generation, and `approvalInTasks` for Tasks. Each policy has a `default` mode plus exact per-tool `overrides`; a matching override wins. When a chat Turn proposes a call that needs a person, the Turn pauses and Blazing Agents saves a pending approval on the Session. Your backend lists pending approvals, shows them to a reviewer, then sends the complete round of decisions in one call that records them and streams the continuing Turn. Nothing runs until a client makes that call. You never run a built-in or MCP tool yourself; backend functions are the exception: their handlers run in your backend (see [backend functions](backend-functions.md)).

| Mode | What happens to a call |
| --- | --- |
| `full` | Runs without approval. The default. |
| `deny` | Is blocked. |
| `manual` | Waits for a person. |
| `auto` | The Agent's model allows it, denies it, or asks a person. A failed review blocks the call. |

## Build it

1. Set the policies. Built-in tools use `{ type: "builtin", name }` with an individual tool name such as `bash`, `write`, or `save_memory`. MCP tools use `{ type: "mcp", connectionId, name }` with the original tool name from an attached Connection. The Agent must actually have each tool you name. Overrides cannot name backend functions; those follow only `approvalInChat.default`.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const agentId: string; // e.g. "ag_0123456789abcdef"
declare const mcpConnectionId: string; // attached to this Agent

const client = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });

await client.agents.update({
  agentId,
  approvalInChat: {
    default: "full",
    overrides: [
      { tool: { type: "builtin", name: "bash" }, decision: "manual" },
      { tool: { type: "mcp", connectionId: mcpConnectionId, name: "refund_order" }, decision: "manual" },
      { tool: { type: "mcp", connectionId: mcpConnectionId, name: "send_email" }, decision: "auto" },
    ],
  },
  approvalInTasks: {
    default: "deny",
    overrides: [{ tool: { type: "builtin", name: "read" }, decision: "full" }],
  },
});
```

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

2. After a chat stream ends, list the Session's approvals on your backend and send the pending ones to the reviewer. In a `useChat` UI, the paused Turn ends with a tool part in the `approval-requested` state; use that as the cue to fetch this list. Here the signed-in user reviews their own Session: the backend reads the user's Agent ID from trusted state, validates the Session ID, and calls BA under that user's scope, so BA rejects another user's Session. For a separate reviewer role, check it in your backend and scope the calls to the Session's owner.

```ts
import { BlazingAgents } from "@blazingagents/sdk";
import { sessionIdSchema } from "@blazingagents/sdk/contracts";

declare function authenticate(request: Request): Promise<{ id: string; agentId: string } | null>;

const tenant = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });

export async function GET(request: Request): Promise<Response> {
  const user = await authenticate(request);
  if (!user) return new Response("Sign in first.", { status: 401 });
  const sessionId = sessionIdSchema.safeParse(new URL(request.url).searchParams.get("sessionId"));
  if (!sessionId.success) return new Response("Invalid Session ID.", { status: 400 });

  const { data } = await tenant.forUser(user.id).sessions.toolApprovals({
    agentId: user.agentId,
    sessionId: sessionId.data,
  });
  const pending = data
    .filter((item) => item.decision === "pending")
    .map((item) => ({ approvalId: item.approvalId, tool: item.tool ?? item.toolName, input: item.input }));
  return Response.json({ pending });
}
```

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
    approvals = await client.sessions.tool_approvals(
        agent_id=agent_for_user(user_id),
        session_id=session_id,
        extra_headers={"X-BA-User-Id": user_id},
    )
    pending = [
        {"approvalId": item.approval_id, "tool": item.tool or item.tool_name, "input": item.input}
        for item in approvals.data
        if item.decision == "pending"
    ]
    return {"pending": pending}
```

3. Send the complete round of decisions in one call. Every pending approval from the same round needs an entry, and an incomplete, duplicate, or mixed set fails `validation_failed`. `continueChat` records the round and streams the rest of the Turn, so relay the response to the browser like a chat Turn. When the chat attached backend functions, pass the same `functions` map or the approved calls cannot run; see [backend functions](backend-functions.md). Identical retries are safe: the same decisions return the running or settled outcome without recording twice.

```ts
import { BlazingAgents } from "@blazingagents/sdk";
import { sessionIdSchema, toolApprovalDecisionSchema } from "@blazingagents/sdk/contracts";
import { z } from "zod";

declare function authenticate(request: Request): Promise<{ id: string; agentId: string } | null>;

const tenant = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });
const bodySchema = z.object({
  sessionId: sessionIdSchema,
  decisions: z.array(toolApprovalDecisionSchema).min(1),
});

export async function POST(request: Request): Promise<Response> {
  const user = await authenticate(request);
  if (!user) return new Response("Sign in first.", { status: 401 });
  const body = bodySchema.safeParse(await request.json());
  if (!body.success) return new Response("Invalid request.", { status: 400 });

  const continued = await tenant.forUser(user.id).continueChat({
    agentId: user.agentId,
    sessionId: body.data.sessionId,
    decisions: body.data.decisions,
    abortSignal: request.signal,
  });
  return continued.toResponse();
}
```

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
    stream = await client.continue_chat(
        agent_id=agent_for_user(user_id),
        session_id=body.sessionId,
        decisions=decisions,
        extra_headers={"X-BA-User-Id": user_id},
    )
    return StreamingResponse(
        stream,
        headers={"x-vercel-ai-ui-message-stream": "v1"},
        media_type="text/event-stream",
    )
```

4. In the browser, collect the round's decisions and render the continued answer with the AI SDK stream helpers. `renderAssistant` is your callback; replace the displayed message by its ID on each update.

```ts
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage } from "ai";

declare function renderAssistant(message: UIMessage): void;

export async function sendDecisions(input: {
  sessionId: string;
  decisions: { approvalId: string; approved: boolean; reason?: string }[];
}): Promise<void> {
  const response = await fetch("/api/tool-approvals/continue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok || !response.body) throw new Error("Approval request failed");

  const chunks = parseJsonEventStream({ stream: response.body, schema: uiMessageChunkSchema }).pipeThrough(
    new TransformStream({
      transform(result, controller) {
        if (!result.success) throw result.error;
        controller.enqueue(result.value);
      },
    }),
  );
  for await (const message of readUIMessageStream({ stream: chunks, terminateOnError: true })) {
    renderAssistant(message);
  }
}
```

In a `useChat` UI, `BlazingAgentsChatTransport` and `BlazingAgentsDirectChatTransport` can do this instead: once `addToolApprovalResponse` has answered every call in the round, the next `sendMessages` posts the answered assistant message. The transport does it for you only with a backend built on `createChatRelay` (or the direct transport's own client), which turns that message into `continueChat` and streams the continuation through the same endpoint. A hand-written chat handler must accept the assistant message and call `continueChat` itself, as the handler in [chat in your app](chat-in-your-app.md) does.

## Gotchas

- Only interactive chat can wait for a person. In Tasks and stateless generation, `manual` calls and `auto` calls that escalate are blocked and the agent continues with what it may do. Use `approvalInTasks` with `full` or `deny`, not `manual`.
- Sending a policy replaces it whole; leaving out `overrides` clears them. Leaving a policy out of the update keeps it. Read the Agent first if you only want to add one override.
- An override must name a tool the Agent has, once per policy. Removing a tool group or detaching a Connection makes a policy that names its tools invalid, so update the policy in the same change.
- MCP overrides use the original tool name, not the generated name you see in saved messages. For display, prefer the approval's `tool` field, which has the MCP `connectionId` and original `name`; `toolName` is the generated name.
- Send decisions through your backend with `continueChat`/`continue_chat`. Answering only in the browser with AI SDK `addToolApprovalResponse` does not resume the agent unless your chat path relays it, as described above.
- While approvals are pending or a continuation runs, new chat messages and regeneration fail with `session_busy`, and a Session input fails with `steer_not_available`. An approval wait refuses steering, so a message sent then waits in your client's queue, as in [chat in your app](chat-in-your-app.md).
- A dropped stream does not prove the continuation stopped. Retry `continueChat`/`continue_chat` with the same decisions: identical decisions are idempotent and the first recorded `reason` stays authoritative, while reversing a decision returns `tool_approval_decision_conflict` (409). A running round returns `session_busy` and a settled one returns `tool_approval_continuation_settled` without running again. `toolApprovals()` also returns the Session's current `continuation` with its `id` and `state` (`waiting`, `running`, `succeeded`, `failed`).
- Authenticate the reviewer and use the verified user scope from [multi-user apps](multi-user-apps.md) for approval reads, decisions, and continuation. Keep additional reviewer roles in your backend. The decision cannot change the saved call's arguments.
- `auto` review runs on the Agent's model and counts toward the Turn's usage.

## Check it works

- Ask the agent to run a shell command. The chat stream ends and `toolApprovals()` lists one `pending` item for `bash` with the command in `input`.
- Approve it. The resumed stream shows the command's result and the agent's answer. Reload the newest history page: the same assistant message, at the same position, now holds the result. A poll with `after: latestCursor` returns nothing new.
- Repeat and deny it. The agent receives a denied result and says it could not run the command.
- Send a new chat message while an approval is pending; it fails with `session_busy`. A Session input submitted then fails with `steer_not_available`, so hold it in your client and send it after the continuation settles. Repeat the same decisions on `continueChat`; the settled round returns `tool_approval_continuation_settled` instead of running again.
- Start a Task that needs a `manual` tool; the call is blocked and nothing waits.

## Go deeper

- [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals)
- [Built-in tools](https://docs.blazingagents.com/agents/tools/built-in-tools) and [MCP tools](https://docs.blazingagents.com/agents/tools/mcp-tools)
- Approval methods in the [TypeScript SDK](https://docs.blazingagents.com/sdk/typescript/sessions), [Python SDK](https://docs.blazingagents.com/sdk/python/sessions), and [REST API](https://docs.blazingagents.com/api-reference/rest-api/sessions)
- [Streaming protocol](https://docs.blazingagents.com/api-reference/protocols/streaming)
- Chat relay examples: [Next.js](https://github.com/blazingagents/examples/tree/main/nextjs-ai-sdk), [Vite + FastAPI](https://github.com/blazingagents/examples/tree/main/vite-fastapi-ai-sdk)
