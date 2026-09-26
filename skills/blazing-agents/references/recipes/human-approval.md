# Require approval before your agent runs a tool

At the end, risky tool calls pause for a person in your app, who sees the tool and its arguments and approves or denies it, and the agent then carries on in the same chat.

## When to use this

Your agent can run shell commands, send email, change records, or call any tool you want a person to sign off first, or you want some tools blocked outright. If you instead want Slack or Telegram approval buttons, those are built in; read [slack-and-telegram.md](slack-and-telegram.md).

## How it works

Each Agent has two approval policies: `approvalInChat` for chat and stateless generation, and `approvalInTasks` for Tasks. Each policy has a `default` mode plus exact per-tool `overrides`; a matching override wins. When a chat Turn proposes a call that needs a person, the Turn pauses and Blazing Agents saves a pending approval on the Session. Your backend lists pending approvals, shows them to a reviewer, and sends each decision by approval ID. Once every pending call is decided, Blazing Agents resumes the agent in a new Turn called a continuation, and your backend streams it back by joining it. You never run the tool yourself.

| Mode | What happens to a call |
| --- | --- |
| `full` | Runs without approval. The default. |
| `deny` | Is blocked. |
| `manual` | Waits for a person. |
| `auto` | The Agent's model allows it, denies it, or asks a person. A failed review blocks the call. |

## Build it

1. Set the policies. Builtin tools use `{ type: "builtin", name }` with an individual tool name such as `bash`, `write`, or `save_memory`. MCP tools use `{ type: "mcp", connectionId, name }` with the original tool name from an attached Connection. The Agent must actually have each tool you name.

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

2. After a chat stream ends, list the Session's approvals on your backend and send the pending ones to the reviewer. In a `useChat` UI, the paused Turn ends with a tool part in the `approval-requested` state; use that as the cue to fetch this list.

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare function reviewerMayAccess(request: Request, sessionId: string): Promise<boolean>;

const client = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId") ?? "";
  const sessionId = url.searchParams.get("sessionId") ?? "";
  if (!(await reviewerMayAccess(request, sessionId))) return new Response(null, { status: 403 });

  const { data } = await client.sessions.toolApprovals({ agentId, sessionId });
  const pending = data
    .filter((item) => item.decision === "pending")
    .map((item) => ({ approvalId: item.approvalId, tool: item.tool ?? item.toolName, input: item.input }));
  return Response.json({ pending });
}
```

```python
from blazing_agents import AsyncBlazingAgents
from fastapi import FastAPI

app = FastAPI()
client = AsyncBlazingAgents()


@app.get("/api/tool-approvals")
async def list_pending(agent_id: str, session_id: str) -> dict[str, object]:
    # Authenticate the reviewer and check they may access this Session first.
    approvals = await client.sessions.tool_approvals(agent_id=agent_id, session_id=session_id)
    pending = [
        {"approval_id": item.approval_id, "tool": item.tool or item.tool_name, "input": item.input}
        for item in approvals.data
        if item.decision == "pending"
    ]
    return {"pending": pending}
```

3. Send each decision by approval ID. When the answer is `waiting`, other calls in the same Turn still need a decision. Otherwise join the continuation and relay its stream to the browser.

```ts
import { BlazingAgents } from "@blazingagents/sdk";
import { z } from "zod";

declare function reviewerMayAccess(request: Request, sessionId: string): Promise<boolean>;

const client = new BlazingAgents({ apiKey: process.env.BLAZING_AGENTS_API_KEY ?? "" });
const bodySchema = z.object({
  agentId: z.string(),
  sessionId: z.string(),
  approvalId: z.string(),
  approved: z.boolean(),
});

export async function POST(request: Request): Promise<Response> {
  const { agentId, sessionId, approvalId, approved } = bodySchema.parse(await request.json());
  if (!(await reviewerMayAccess(request, sessionId))) return new Response(null, { status: 403 });

  const decision = await client.sessions.decideToolApproval({ agentId, sessionId, approvalId, approved });
  if (decision.state === "waiting") return Response.json({ state: "waiting" }, { status: 202 });

  const resumed = await client.sessions.joinToolApprovalContinuation({
    agentId,
    sessionId,
    continuationId: decision.continuationId,
  });
  return resumed.toResponse();
}
```

```python
from blazing_agents import AsyncBlazingAgents
from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

app = FastAPI()
client = AsyncBlazingAgents()


class Decision(BaseModel):
    agent_id: str
    session_id: str
    approval_id: str
    approved: bool


@app.post("/api/tool-approval")
async def decide(body: Decision) -> JSONResponse | StreamingResponse:
    # Authenticate the reviewer and check they may access this Session first.
    decision = await client.sessions.decide_tool_approval(
        agent_id=body.agent_id,
        session_id=body.session_id,
        approval_id=body.approval_id,
        approved=body.approved,
    )
    if decision.state == "waiting":
        return JSONResponse({"state": "waiting"}, status_code=202)
    resumed = await client.sessions.join_tool_approval_continuation(
        agent_id=body.agent_id,
        session_id=body.session_id,
        continuation_id=decision.continuation_id,
    )
    return StreamingResponse(
        resumed,
        headers={"x-vercel-ai-ui-message-stream": "v1"},
        media_type="text/event-stream",
    )
```

4. In the browser, post the decision and render the resumed answer with the AI SDK stream helpers. `renderAssistant` is your callback; replace the displayed message by its ID on each update.

```ts
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage } from "ai";

declare function renderAssistant(message: UIMessage): void;

export async function sendDecision(input: {
  agentId: string;
  sessionId: string;
  approvalId: string;
  approved: boolean;
}): Promise<void> {
  const response = await fetch("/api/tool-approval", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Approval request failed");
  if (response.status === 202 || !response.body) return; // Other calls still wait; keep their buttons.

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

## Gotchas

- Only interactive chat can wait for a person. In Tasks and stateless generation, `manual` calls and `auto` calls that escalate are blocked and the agent continues with what it may do. Use `approvalInTasks` with `full` or `deny`, not `manual`.
- Sending a policy replaces it whole; leaving out `overrides` clears them. Leaving a policy out of the update keeps it. Read the Agent first if you only want to add one override.
- An override must name a tool the Agent has, once per policy. Removing a tool group or detaching a Connection makes a policy that names its tools invalid, so update the policy in the same change.
- MCP overrides use the original tool name, not the generated name you see in saved messages. For display, prefer the approval's `tool` field, which has the MCP `connectionId` and original `name`; `toolName` is the runtime name.
- Send decisions through your backend with `decideToolApproval`. Answering only in the browser with AI SDK `addToolApprovalResponse` does not resume the agent.
- Decide every pending call before expecting a stream. A `waiting` state is normal when a Turn proposed several calls.
- While approvals are pending or a continuation runs, new chat messages and regeneration fail with `session_busy`. Disable the composer until the continuation ends.
- A dropped stream does not stop the continuation. Join the same `continuationId` again; it replays from the start and never reruns the tool. `toolApprovals()` also returns the Session's current `continuation` with its `id` and `state`.
- The same decision sent twice is safe. Reversing a decision returns `409`.
- Authenticate and authorize the reviewer on your backend, and keep the API key there. The decision cannot change the saved call's arguments.
- `auto` review runs on the Agent's model and counts toward the Turn's usage.

## Check it works

- Ask the agent to run a shell command. The chat stream ends and `toolApprovals()` lists one `pending` item for `bash` with the command in `input`.
- Approve it. The resumed stream shows the command's result and the agent's answer.
- Repeat and deny it. The agent receives a denied result and says it could not run the command.
- Send a new message while an approval is pending; it fails with `session_busy`.
- Start a Task that needs a `manual` tool; the call is blocked and nothing waits.

## Go deeper

- [Tool approvals](https://docs.blazingagents.com/agents/tools/tool-approvals)
- [Built-in tools](https://docs.blazingagents.com/agents/tools/built-in-tools) and [MCP tools](https://docs.blazingagents.com/agents/tools/mcp-tools)
- Approval methods in the [TypeScript SDK](https://docs.blazingagents.com/sdk/typescript/sessions), [Python SDK](https://docs.blazingagents.com/sdk/python/sessions), and [REST API](https://docs.blazingagents.com/api-reference/rest-api/sessions)
- [Streaming protocol](https://docs.blazingagents.com/api-reference/protocols/streaming)
- Chat relay examples: [Next.js](https://github.com/blazingagents/examples/tree/main/nextjs-ai-sdk), [Vite + FastAPI](https://github.com/blazingagents/examples/tree/main/vite-fastapi-ai-sdk)
