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

```rust
use blazing_agents::agents::{AgentTool, ApprovalDecision, ApprovalPolicy, ToolReference};

let mcp_connection_id = "mcp_0123456789abcdef";
client
    .agents()
    .update("ag_0123456789abcdef")
    .approval_in_chat(
        ApprovalPolicy::new(ApprovalDecision::Full)
            .with_override(
                ToolReference::builtin(AgentTool::Bash),
                ApprovalDecision::Manual,
            )
            .with_override(
                ToolReference::mcp(mcp_connection_id, "refund_order"),
                ApprovalDecision::Manual,
            )
            .with_override(
                ToolReference::mcp(mcp_connection_id, "send_email"),
                ApprovalDecision::Auto,
            ),
    )
    .approval_in_tasks(
        ApprovalPolicy::new(ApprovalDecision::Deny)
            .with_override(ToolReference::builtin(AgentTool::Read), ApprovalDecision::Full),
    )
    .await?;
```

```go
mcpConnectionID := ba.MCPConnectionID("mcp_0123456789abcdef")
_, err := client.Agents.Update(ctx, agentID, ba.UpdateAgentParams{
	ApprovalInChat: &ba.ApprovalPolicy{
		Default: ba.ApprovalModeFull,
		Overrides: []ba.ApprovalOverride{
			{Tool: ba.ToolReferenceBuiltin{Name: ba.AgentToolBash}, Decision: ba.ApprovalModeManual},
			{Tool: ba.ToolReferenceMCP{ConnectionID: mcpConnectionID, Name: "refund_order"}, Decision: ba.ApprovalModeManual},
			{Tool: ba.ToolReferenceMCP{ConnectionID: mcpConnectionID, Name: "send_email"}, Decision: ba.ApprovalModeAuto},
		},
	},
	ApprovalInTasks: &ba.ApprovalPolicy{
		Default: ba.ApprovalModeDeny,
		Overrides: []ba.ApprovalOverride{
			{Tool: ba.ToolReferenceBuiltin{Name: ba.AgentToolRead}, Decision: ba.ApprovalModeFull},
		},
	},
})
if err != nil {
	return err
}
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

```rust
use axum::extract::{Json, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use blazing_agents::sessions::ToolApprovalStatus;
use blazing_agents::{Client, Error};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct ApprovalsQuery {
    #[serde(rename = "sessionId")]
    session_id: String,
}

fn current_user(headers: &HeaderMap) -> String {
    // Your sign-in check: verify the session token and return its user ID.
    let _ = headers;
    todo!("verify the signed-in user")
}

fn agent_for_user(_user_id: &str) -> String {
    // Read this user's Agent ID from trusted backend state.
    "ag_0123456789abcdef".to_owned()
}

async fn list_pending(
    State(client): State<Client>,
    headers: HeaderMap,
    Query(query): Query<ApprovalsQuery>,
) -> Response {
    let user_id = current_user(&headers);
    let Ok(scoped) = client.for_user(&user_id) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    scoped
        .sessions()
        .tool_approvals(agent_for_user(&user_id), query.session_id)
        .await
        .map(|approvals| {
            let pending: Vec<_> = approvals
                .data
                .iter()
                .filter(|item| item.decision == ToolApprovalStatus::Pending)
                .map(|item| {
                    json!({
                        "approvalId": item.approval_id,
                        "tool": item
                            .tool
                            .as_ref()
                            .map_or_else(|| json!(item.tool_name), |tool| json!(tool)),
                        "input": item.input,
                    })
                })
                .collect();
            Json(json!({ "pending": pending })).into_response()
        })
        .unwrap_or_else(|error| {
            (
                match error {
                    Error::Api(api) => {
                        StatusCode::from_u16(api.status()).unwrap_or(StatusCode::BAD_GATEWAY)
                    }
                    _ => StatusCode::BAD_GATEWAY,
                },
                Json(json!({ "error": "upstream" })),
            )
                .into_response()
        })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = Router::new()
        .route("/api/tool-approvals", get(list_pending))
        .with_state(Client::from_env()?);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

```go
package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	ba "github.com/blazingagents/golang-sdk"
)

func currentUser(r *http.Request) (string, bool) {
	// Your sign-in check: verify the session token and return its user ID.
	return "", false
}

func agentForUser(userID string) ba.AgentID {
	// Read this user's Agent ID from trusted backend state.
	return "ag_0123456789abcdef"
}

func failure(w http.ResponseWriter, err error) {
	var apiErr *ba.APIError
	var argErr *ba.ArgumentError
	switch {
	case errors.As(err, &argErr): // an invalid ID never reaches the URL
		http.Error(w, "Invalid request.", http.StatusBadRequest)
	case errors.As(err, &apiErr):
		http.Error(w, string(apiErr.Code), apiErr.Status)
	default:
		http.Error(w, "Request failed.", http.StatusBadGateway)
	}
}

func listPending(client *ba.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := currentUser(r)
		if !ok {
			http.Error(w, "Sign in first.", http.StatusUnauthorized)
			return
		}
		scoped, err := client.ForUser(userID)
		if err != nil {
			http.Error(w, "Sign in first.", http.StatusUnauthorized)
			return
		}
		sessionID := ba.SessionID(r.URL.Query().Get("sessionId"))
		approvals, err := scoped.Sessions.ListToolApprovals(r.Context(), agentForUser(userID), sessionID)
		if err != nil {
			failure(w, err)
			return
		}
		type pending struct {
			ApprovalID ba.ApprovalID `json:"approvalId"`
			Tool       any           `json:"tool"`
			Input      ba.Metadata   `json:"input"`
		}
		var items []pending
		for _, item := range approvals.Data {
			if item.Decision != ba.ToolApprovalStatusPending {
				continue
			}
			var tool any = item.Tool
			if tool == nil {
				tool = item.ToolName
			}
			items = append(items, pending{ApprovalID: item.ApprovalID, Tool: tool, Input: item.Input})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"pending": items})
	}
}

func main() {
	client, err := ba.NewClient() // reads BLAZING_AGENTS_API_KEY
	if err != nil {
		log.Fatal(err)
	}
	http.Handle("GET /api/tool-approvals", listPending(client))
	log.Fatal(http.ListenAndServe(":3000", nil))
}
```

3. Send the complete round of decisions in one call. Every pending approval from the same round needs an entry, and an incomplete, duplicate, or mixed set fails `validation_failed`. `continueChat` (`continue_chat` in Python and Rust, `Chat.Continue` in Go) records the round and streams the rest of the Turn, so relay the response to the browser like a chat Turn. When the chat attached backend functions, pass the same `functions` map or the approved calls cannot run; see [backend functions](backend-functions.md). Identical retries are safe: the same decisions return the running or settled outcome without recording twice.

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

```rust
use axum::body::Body;
use axum::extract::{Json, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::post;
use axum::Router;
use blazing_agents::chat::ToolApprovalDecision;
use blazing_agents::Client;
use serde::Deserialize;

#[derive(Deserialize)]
struct Decision {
    #[serde(rename = "approvalId")]
    approval_id: String,
    approved: bool,
    reason: Option<String>,
}

#[derive(Deserialize)]
struct ContinueBody {
    #[serde(rename = "sessionId")]
    session_id: String,
    decisions: Vec<Decision>,
}

fn current_user(headers: &HeaderMap) -> String {
    // Your sign-in check: verify the session token and return its user ID.
    let _ = headers;
    todo!("verify the signed-in user")
}

fn agent_for_user(_user_id: &str) -> String {
    // Read this user's Agent ID from trusted backend state.
    "ag_0123456789abcdef".to_owned()
}

async fn continue_round(
    State(client): State<Client>,
    headers: HeaderMap,
    Json(body): Json<ContinueBody>,
) -> Result<Response, StatusCode> {
    let user_id = current_user(&headers);
    if body.decisions.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let decisions = body.decisions.iter().map(|d| {
        let decision = if d.approved {
            ToolApprovalDecision::approve(&d.approval_id)
        } else {
            ToolApprovalDecision::deny(&d.approval_id)
        };
        match &d.reason {
            Some(reason) => decision.reason(reason.clone()),
            None => decision,
        }
    });
    let scoped = client.for_user(&user_id).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let stream = scoped
        .continue_chat(agent_for_user(&user_id), &body.session_id, decisions)
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    let mut response = Response::builder()
        .header("content-type", "text/event-stream")
        .header("x-vercel-ai-ui-message-stream", "v1");
    if let Some(turn_id) = stream.meta().headers().get("x-ba-turn-id") {
        response = response.header("x-ba-turn-id", turn_id.clone());
    }
    response
        .body(Body::from_stream(stream))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = Router::new()
        .route("/api/tool-approvals/continue", post(continue_round))
        .with_state(Client::from_env()?);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

```go
package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	ba "github.com/blazingagents/golang-sdk"
)

type decision struct {
	ApprovalID ba.ApprovalID `json:"approvalId"`
	Approved   bool          `json:"approved"`
	Reason     string        `json:"reason"`
}

type continueBody struct {
	SessionID ba.SessionID `json:"sessionId"`
	Decisions []decision   `json:"decisions"`
}

func currentUser(r *http.Request) (string, bool) {
	// Your sign-in check: verify the session token and return its user ID.
	return "", false
}

func agentForUser(userID string) ba.AgentID {
	// Read this user's Agent ID from trusted backend state.
	return "ag_0123456789abcdef"
}

func failure(w http.ResponseWriter, err error) {
	var apiErr *ba.APIError
	var argErr *ba.ArgumentError
	switch {
	case errors.As(err, &argErr):
		http.Error(w, "Invalid request.", http.StatusBadRequest)
	case errors.As(err, &apiErr):
		http.Error(w, string(apiErr.Code), apiErr.Status)
	default:
		http.Error(w, "Request failed.", http.StatusBadGateway)
	}
}

func continueRound(client *ba.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := currentUser(r)
		if !ok {
			http.Error(w, "Sign in first.", http.StatusUnauthorized)
			return
		}
		var body continueBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Decisions) == 0 {
			http.Error(w, "Invalid request.", http.StatusBadRequest)
			return
		}
		decisions := make([]ba.ToolApprovalDecision, 0, len(body.Decisions))
		for _, item := range body.Decisions {
			d := ba.Deny(item.ApprovalID, item.Reason) // "" sends no reason
			if item.Approved {
				d = ba.Approve(item.ApprovalID)
				if item.Reason != "" {
					d.Reason = new(item.Reason)
				}
			}
			decisions = append(decisions, d)
		}
		scoped, err := client.ForUser(userID)
		if err != nil {
			http.Error(w, "Sign in first.", http.StatusUnauthorized)
			return
		}
		stream, err := scoped.Chat.Continue(r.Context(), agentForUser(userID), body.SessionID, decisions, ba.ContinueParams{})
		if err != nil {
			failure(w, err)
			return
		}
		defer stream.Close()
		stream.SetRelayHeaders(w.Header())
		if _, err := stream.WriteTo(w); err != nil {
			log.Printf("relay ended: %v", err)
		}
	}
}

func main() {
	client, err := ba.NewClient() // reads BLAZING_AGENTS_API_KEY
	if err != nil {
		log.Fatal(err)
	}
	http.Handle("POST /api/tool-approvals/continue", continueRound(client))
	log.Fatal(http.ListenAndServe(":3000", nil))
}
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
- An override must name a tool the Agent has, once per policy. A built-in override must name a tool in the Agent's `tools`; `activate_skill` and `read` are also allowed while the Agent has a Skill. Removing a tool, detaching a Connection, or deleting the last Skill fails while a policy names an affected tool, so update the policy in the same change or first.
- MCP overrides use the original tool name, not the generated name you see in saved messages. For display, prefer the approval's `tool` field, which has the MCP `connectionId` and original `name`; `toolName` is the generated name.
- Send decisions through your backend with `continueChat`/`continue_chat`. Answering only in the browser with AI SDK `addToolApprovalResponse` does not resume the agent unless your chat path relays it, as described above.
- While approvals are pending or a continuation runs, new chat messages and regeneration fail with `session_busy`, and a Session input fails with `steer_not_available`. An approval wait refuses steering, so a message sent then waits in your client's queue, as in [chat in your app](chat-in-your-app.md).
- A dropped stream does not prove the continuation stopped. Retry `continueChat`/`continue_chat` with the same decisions: identical decisions are idempotent and the first recorded `reason` stays authoritative, while reversing a decision returns `tool_approval_decision_conflict` (409). A running round returns `session_busy` and a settled one returns `tool_approval_continuation_settled` without running again. A round whose Turn stopped responding returns `session_turn_unresponsive` with a `Retry-After` header and keeps its recorded decisions, so repeat the same call after that wait. `toolApprovals()` also returns the Session's current `continuation` with its `id` and `state` (`waiting`, `running`, `succeeded`, `failed`).
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
