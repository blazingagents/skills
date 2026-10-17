# Go SDK reference

Use this page to call Blazing Agents from a Go backend: install the module, build a client, run Turns, and find the method for every operation. It matches the module `github.com/blazingagents/golang-sdk` at commit `5c762cb` of the repository's main branch, the revision this skill's snippets compile against. The module has no tagged release yet, so install it by that commit's pseudo-version.

For the same surface in TypeScript, Python, or Rust, read [TypeScript SDK reference](sdk-typescript.md), [Python SDK reference](sdk-python.md), or [Rust SDK reference](sdk-rust.md). For end-to-end builds, start from a recipe such as [Add chat to your app](recipes/chat-in-your-app.md).

The snippets on this page assume a `client` built as shown in [Construct](#construct); short fragments appear inside a function that receives `ctx`, `client`, an `agentID`, and a `sessionID`.

## Install

The module is `github.com/blazingagents/golang-sdk`, and its one package is `blazingagents`. The examples import it under the alias ba, as in `ba.NewClient()`. It needs Go 1.26 or newer and depends on the standard library only.

```bash
go get github.com/blazingagents/golang-sdk@v0.0.0-20261017095851-5c762cba38a4
```

```go
package main

import (
	"context"
	"fmt"
	"log"

	ba "github.com/blazingagents/golang-sdk"
)

func main() {
	client, err := ba.NewClient() // reads BLAZING_AGENTS_API_KEY
	if err != nil {
		log.Fatal(err)
	}
	reply, err := client.Generation.Completion(context.Background(),
		"ag_0123456789abcdef", ba.Text("Write a friendly welcome message."), ba.GenerateParams{})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(reply)
}
```

Keep the Tenant API key in `BLAZING_AGENTS_API_KEY` on your backend. It can reach everything in your Tenant, so it never goes to a browser or mobile app.

## One client, context first

There is one `*ba.Client`, safe for concurrent use. Resources are fields on it (`client.Agents`, `client.Sessions`, `client.Chat`), and every method takes a `context.Context` first, then typed path IDs, then one params struct that holds every body, query, and header input, and finally optional `ba.RequestOption` values. A method returns `(*Model, error)`, `error`, `(*ba.Page[T], error)`, or a stream. On error the model is always `nil`.

Field kinds in a params struct follow the API's field kinds. A required field is a plain value. An optional field is a pointer, set with Go 1.26 `new(expr)`, such as `Limit: new(50)`. An optional list or map is a plain slice or map that is omitted while `nil`. A field the API lets you omit, send as `null`, or set is a `ba.Nullable[T]`: leave it zero to omit, `ba.Null[T]()` to clear, `ba.Value(v)` to set. A required field that the API accepts as `null`, such as `SpendingLimit` or `MerchantGuard.MeterID`, is a pointer with no omit rule, so `nil` sends `null`.

## Construct

Create one client per process and reuse it. `ba.NewClient()` reads `BLAZING_AGENTS_API_KEY` and makes no network request. It fails with `ba.ErrMissingAPIKey` when the key is unset, and with `ba.ErrInvalidAPIKey` when it is not a `ba_read_` or `ba_full_` key followed by 40 letters and digits, so a mistyped key is caught at startup, not on the first call.

```go
client, err := ba.NewClient() // reads BLAZING_AGENTS_API_KEY
if err != nil {
	return err
}
reply, err := client.Generation.Completion(ctx, agentID, ba.Text("Write a friendly welcome message."), ba.GenerateParams{})
if err != nil {
	return err
}
fmt.Println(reply)
```

Options:

| Option | Default | Use |
| --- | --- | --- |
| `ba.WithAPIKey(key)` | `BLAZING_AGENTS_API_KEY` | Tenant API key |
| `ba.WithBaseURL(url)` | `https://api.blazingagents.com` | API origin; trailing slashes are removed |
| `ba.WithTimeout(d)` | 60 seconds | Send to fully read body for an ordinary call; only the wait for headers on a stream. `0` disables it |
| `ba.WithConnectTimeout(d)` | 10 seconds | Dial timeout of the default transport. Not allowed together with `WithTransport` |
| `ba.WithStreamIdleTimeout(d)` | off | Longest gap between two reads of a stream or download body |
| `ba.WithTransport(rt)` | a clone of `http.DefaultTransport` | Proxies, TLS, tracing, or a test double |
| `ba.WithHeader(name, value)` | none | Header sent on every request. SDK-owned headers (`Authorization`, `X-BA-User-Id`, `X-Request-Id`, `X-Client-Request-Id`, `Content-Type`, `Idempotency-Key`) fail with `ba.ErrInvalidHeader` |
| `ba.WithUserAgent(ua)` | none | Appended to `blazing-agents-go/<Version>` |
| `ba.WithObserver(fn)` | none | `func(ba.ResponseObservation)` called once per response, with `OperationID`, `Method`, `Path`, `Status`, `Duration`, `RequestID`, and `ClientRequestID` |
| `ba.WithLogger(l)` | discard | A `*slog.Logger` that gets one Debug record per response and the backend-function runner's records; never bodies or headers |

`client.WithClientRequestID("checkout-42")` returns a `(*ba.Client, error)`: a copy of the client that tags every request with your correlation ID, or `ba.ErrInvalidHeader` when the ID is not printable ASCII without leading or trailing spaces. The original is unchanged. Every call also accepts per-call options: `ba.WithRequestTimeout(d)`, `ba.WithRequestHeader(name, value)`, `ba.WithClientRequestID(id)`, and `ba.CaptureResponse(&meta)`, which fills a `ba.ResponseMeta` (`OperationID`, `Status`, `Header`, `RequestID`, `ClientRequestID`) once headers arrive, on success and on an API error. The SDK retries transient claim and result submissions for backend functions; other requests do not retry on their own.

## Run Turns: generation methods

`client.Chat` and `client.Generation` hold the generation methods. Each call runs one metered Turn. The prompt argument is a `ba.PromptInput`: pass `ba.Text("...")` for literal text or `ba.SavedPrompt{ID: promptID, Variables: map[string]string{...}}` for a saved Prompt, and supply exactly the names its `variables` lists. Chat takes a `ba.ChatInput` built with `ba.Messages(first, rest...)`, which is non-empty by construction: one `ba.UserMessage`, or several for messages your client held while the Session was busy. `ba.TextMessage("...")` builds a message with a random ID, and a `ba.UserMessage` also decodes from the AI SDK `UIMessage` JSON your frontend sends. Every params struct has `UserID` and `Metadata` for Attribution to your end user.

| Method | Returns | Use it for |
| --- | --- | --- |
| `client.Chat.Send(ctx, agentID, input, ba.ChatParams{...})` | `*ba.ChatStream` | A conversation stored as a Session. `SessionID: id` resumes one; `""` starts one |
| `client.Chat.Regenerate(ctx, agentID, sessionID, input, ba.RegenerateParams{...})` | `*ba.ChatStream` | The answer again; `MessageID` cuts history back first |
| `client.Generation.Completion(ctx, agentID, prompt, ba.GenerateParams{...})` | `string` | Stateless text, buffered |
| `client.Generation.CompletionStream(ctx, agentID, prompt, ba.GenerateParams{...})` | `*ba.CompletionStream` of `string` deltas | Stateless text, streamed. `Text()` drains and returns the whole text |
| `ba.Object(ctx, client.Generation, agentID, prompt, ba.ObjectParams[T]{...})` | `T` | Structured output, validated |
| `ba.StreamObject(ctx, client.Generation, agentID, prompt, ba.ObjectParams[T]{...})` | `*ba.ObjectStream[T]` of raw JSON `string` deltas | Structured output, streamed. `Object()` drains and decodes at the end |

`client.Chat.Continue(ctx, agentID, sessionID, decisions, ba.ContinueParams{...})` is not a generation method: it decides a Session's complete approval round, with backend functions attached through `Functions`, and returns a `*ba.ChatStream` for the continuing Turn. See [Backend functions](#backend-functions).

### Chat returns raw SSE bytes and a Session ID

`client.Chat.Send` returns a `*ba.ChatStream`. `Events()` yields the server's AI SDK UI message stream as raw SSE frames, one complete event per iteration, exactly as sent. The SDK does not decode it. Relay those bytes to your frontend, where `useChat` from `@ai-sdk/react` reads them.

`stream.SessionID()` holds the `ss_...` ID before you read the body, and `stream.TurnID()` holds the running `turn_...` ID for `client.Sessions.Stop`. Send with an empty `SessionID` to start a new Session. Store the returned ID with your user, send it to your frontend, and pass it back in `ba.ChatParams` to continue that conversation.

```go
// message is the AI SDK UIMessage from your frontend: {"id", "role", "parts"}.
var message ba.UserMessage
if err := json.Unmarshal([]byte(`{"id":"msg-1","role":"user","parts":[{"type":"text","text":"Hello"}]}`), &message); err != nil {
	return err
}
stream, err := client.Chat.Send(ctx, agentID, ba.Messages(message), ba.ChatParams{
	SessionID: sessionID, // "" starts a new Session
	UserID:    new("user_123"),
})
if err != nil {
	return err
}
defer stream.Close()
fmt.Println(stream.SessionID(), stream.TurnID())
```

To relay, write the stream into your framework's response. In `net/http`, call `stream.SetRelayHeaders(w.Header())`, which sets `Content-Type`, `Cache-Control`, `X-Vercel-AI-UI-Message-Stream: v1`, and `X-BA-Turn-Id` (the running Turn's `turn_...` ID, used for Stop), then `stream.WriteTo(w)`, which flushes after every event. When the call started a new Session, also copy the response's `Location` header from `stream.Meta().Header`: `BlazingAgentsChatTransport` in your frontend reads the new Session ID from that header.

```go
package main

import (
	"encoding/json"
	"log"
	"net/http"

	ba "github.com/blazingagents/golang-sdk"
)

type chatBody struct {
	Message   ba.UserMessage `json:"message"`
	SessionID ba.SessionID   `json:"sessionId"` // "" starts a Session
}

func chat(client *ba.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body chatBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "Invalid message.", http.StatusBadRequest)
			return
		}
		stream, err := client.Chat.Send(r.Context(), "ag_0123456789abcdef", ba.Messages(body.Message),
			ba.ChatParams{SessionID: body.SessionID})
		if err != nil {
			http.Error(w, "Request failed.", http.StatusBadGateway)
			return
		}
		defer stream.Close()
		stream.SetRelayHeaders(w.Header())
		if body.SessionID == "" {
			w.Header().Set("Location", stream.Meta().Header.Get("Location"))
		}
		if _, err := stream.WriteTo(w); err != nil {
			log.Printf("relay ended: %v", err)
		}
	}
}

func main() {
	client, err := ba.NewClient()
	if err != nil {
		log.Fatal(err)
	}
	http.Handle("POST /api/chat", chat(client))
	log.Fatal(http.ListenAndServe(":3000", nil))
}
```

The full endpoint, including batches and approval continuations, is in [Add chat to your app](recipes/chat-in-your-app.md).

Outside a web request, iterate the events yourself:

```go
stream, err := client.Chat.Send(ctx, agentID, ba.Messages(ba.TextMessage("Hello")), ba.ChatParams{})
if err != nil {
	return err
}
defer stream.Close()
fmt.Println("Session:", stream.SessionID())
for event, err := range stream.Events() {
	if err != nil {
		return err
	}
	// Raw SSE bytes. Forward, log, or store them as you need.
	os.Stdout.Write(event)
}
```

Chat rules the SDK enforces before sending:

- A `ba.UserMessage` decoded from JSON must have role `user`, a non-empty `id`, and non-empty `parts`; anything else fails `json.Unmarshal`.
- `ba.Messages` needs at least one message by its signature, so an empty batch cannot reach the wire.
- A nil chat input, an empty path segment, or a segment of `.` or `..` fails with `*ba.ArgumentError` before anything is sent, and every segment is percent-encoded, so a browser-supplied ID can never leave its path segment.
- A `ba.SavedPrompt` goes out as `promptId` plus `variables`.

### Backend functions

`ba.NewFunctions(defs...)` collects function definitions and their handlers and checks them against the platform's limits. `ba.Function(name, description, handler)` derives the input schema from the handler's input type with `ba.SchemaFor`; `ba.FunctionJSON(name, description, schema, handler)` takes a hand-written JSON Schema and passes the handler the raw `json.RawMessage`. The handler gets a `ctx` that ends at the call's deadline or when the stream closes, a `ba.FunctionCall` (`ID`, the idempotency key for side effects; `Name`; `Deadline`), and the decoded input, and returns `(any, error)`. A returned error or a panic reaches the agent as a sanitized tool error, and its text stays in your logs. Attach the `*ba.Functions` through the `Functions` field of `ba.ChatParams`, `ba.RegenerateParams`, or `ba.ContinueParams`. A `*ba.Functions` is immutable; share one across goroutines and calls when its handlers do not close over request state. Each function's claim and result requests carry the call's per-call headers and client request ID.

`client.Chat.Continue(ctx, agentID, sessionID, decisions, ba.ContinueParams{Functions: fns})` records every decision in the round (`ba.Approve(id)` or `ba.Deny(id, reason)`), reattaches your handlers, and streams the continuing Turn. Keep consuming the stream: function calls dispatch as you read their events, and `Close` cancels every running handler's context. For end-to-end setup, including scoping and approval flow, read [backend functions](recipes/backend-functions.md).

### Structured output

`ba.Object` and `ba.StreamObject` take a type argument `T` and a `ba.ObjectParams[T]`. The zero `Schema` derives the JSON Schema from `T` with `ba.SchemaFor[T]()`: exported fields with `json` tags, a field required unless it is a pointer or tagged `omitempty` or `omitzero`, `jsonschema:"<description>"` for descriptions, and `additionalProperties: false`. `ba.RawSchema[T](schema)` takes a hand-written schema instead; with `T = json.RawMessage` the final JSON is returned without further validation.

```go
type Summary struct {
	Title string   `json:"title"`
	Risks []string `json:"risks"`
}

summary, err := ba.Object(ctx, client.Generation, agentID,
	ba.Text("Summarize the release plan."), ba.ObjectParams[Summary]{})
if err != nil {
	return err
}
fmt.Printf("%s: %d risks\n", summary.Title, len(summary.Risks))
```

A finished generation whose text is not the requested object fails with `*ba.ObjectError`; its `Kind` is `ba.ObjectTruncated`, `ba.ObjectInvalidJSON`, or `ba.ObjectMismatch`, and `Text` holds the complete generated text. See [Get structured output](recipes/structured-output.md) for streaming and failure handling.

### Stream ownership

Every chat, completion, and object stream has exactly one reader. Reading to the end closes it; `Close` ends the connection and cancels running function handlers, so always `defer stream.Close()`. A stream's timeout covers only the wait for headers, so a long reply can read for as long as it takes; `ba.WithStreamIdleTimeout` bounds the gap between reads instead.

## Skills take the Agent ID

There is no Agent handle. Every Skill method on `client.Skills` takes the Agent ID as its first argument after `ctx`.

```go
for skill, err := range client.Skills.All(ctx, agentID, ba.ListSkillsParams{}) {
	if err != nil {
		return err
	}
	fmt.Println(skill.ID, skill.Name)
}
```

## End-user scope

`client.ForUser(userID)` returns a `(*ba.UserClient, error)` without a network request. Every request it makes sends `X-BA-User-Id`, and the API limits reads and writes to resources that user owns. The header is SDK-owned, so no option or per-call header can replace it.

```go
verifiedUserID := "user_123"
scoped, err := client.ForUser(verifiedUserID)
if err != nil {
	return err
}
page, err := scoped.Agents.List(ctx, ba.ListAgentsParams{Limit: new(50)})
if err != nil {
	return err
}
fmt.Println(len(page.Data), page.NextCursor)
```

- Take the ID from the session your backend verified, never from a request body or query parameter.
- The ID is 1 to 256 printable ASCII characters with no leading or trailing space. Anything else fails with `ba.ErrInvalidUserID`.
- A `*ba.UserClient` has `Agents`, `Skills`, `Sessions`, `Memories`, `Prompts`, `Tasks`, `Workspaces`, `Artifacts`, `Chat`, `Generation`, and a `Usage` with `Get`, `Sessions`, and `ForAgent`. Tenant administration (`Providers`, `MCPConnections`, `Tenant`, `SpendingLimits`, `ChatConnections`, `ChatDeliveries`, the merchant services) and `Usage.Overview` exist only on `*ba.Client`; the compiler rejects them on a `*ba.UserClient`.
- `WithClientRequestID` on a `*ba.UserClient` keeps the scope.

## Operation map

Every method is `(ctx, <path IDs>, params, opts...)`; only the arguments after `ctx` are shown. Path IDs are typed (`ba.AgentID`, `ba.SessionID`, and so on), and the params struct is named after the operation. Every call also takes the per-call options from [Construct](#construct). `*ba.Page[T]` means the result is `{Data, NextCursor}` (see [Pagination](#pagination)), and `All` returns an `iter.Seq2[T, error]` over every page.

### `client.Chat` and `client.Generation` (both clients)

| Method | Returns |
| --- | --- |
| `Chat.Send(agentID, input, ba.ChatParams{SessionID, UserID, Metadata, Functions})` | `*ba.ChatStream` |
| `Chat.Regenerate(agentID, sessionID, input, ba.RegenerateParams{MessageID, UserID, Metadata, Functions})` | `*ba.ChatStream` |
| `Chat.Continue(agentID, sessionID, decisions, ba.ContinueParams{Functions})` | `*ba.ChatStream` |
| `Generation.Completion(agentID, prompt, ba.GenerateParams{UserID, Metadata})` / `CompletionStream(...)` | `string` / `*ba.CompletionStream` |
| `ba.Object(ctx, client.Generation, agentID, prompt, ba.ObjectParams[T]{Schema, UserID, Metadata})` / `ba.StreamObject(...)` | `T` / `*ba.ObjectStream[T]` |
| `client.ForUser(userID)` | `*ba.UserClient` for one authenticated user |
| `client.WithClientRequestID(id)` | `*ba.Client`, a copy tagging every call |

### `client.Agents` (both clients)

| Method | Returns |
| --- | --- |
| `Create(ba.CreateAgentParams{Name, ProviderID, Model, ThinkingLevel, WorkspaceID, WorkspaceTier, AutoCompaction, CompactionReserveTokens, MemoryInjectionEnabled, Tools, ApprovalInChat, ApprovalInTasks, Instructions, UserID, Metadata, MCPConnectionIDs})` | `*ba.Agent` |
| `List(ba.ListAgentsParams{UserID, WorkspaceID, Limit, Cursor})` / `All(...)` | `*ba.Page[ba.Agent]` / `iter.Seq2[ba.Agent, error]` |
| `Get(agentID)` | `*ba.Agent` |
| `Update(agentID, ba.UpdateAgentParams{Name, ProviderID, Model, ThinkingLevel, WorkspaceID, AutoCompaction, CompactionReserveTokens, MemoryInjectionEnabled, Tools, ApprovalInChat, ApprovalInTasks, Instructions, Metadata, MCPConnectionIDs})` | `*ba.Agent` |
| `Delete(agentID, ba.DeleteAgentParams{IncludeArtifacts})` | `error`. The Workspace is kept |
| `Disable(agentID)` / `Enable(agentID)` | `*ba.Agent` |
| `UploadAvatar(agentID, ba.Upload)` | `*ba.Agent`. A PNG, JPEG or WebP of 512 KiB or less |
| `RemoveAvatar(agentID)` | `*ba.Agent` |
| `ListMCPAttachments(agentID)` | `[]ba.MCPAttachment` |
| `UpdateMCPAttachment(agentID, mcpConnectionID, ba.UpdateMCPAttachmentParams{ForwardUserID, ForwardedMetadataKeys})` | `*ba.MCPAttachment` |

On `Create` and `Update`, `ProviderID` and `Model` are `ba.Nullable`. On `Create`, both are omitted, both set with `ba.Value(...)`, or both `ba.Null`. On `Update`, `ba.Value(...)` on both changes Provider and model, `ba.Value` on `Model` alone changes only the model, and `ba.Null` on both clears the model (the SDK then also clears the thinking level). A mismatch fails with `*ba.ArgumentError` before anything is sent, as does `WorkspaceID` together with `WorkspaceTier` on `Create`. `Tools` is `[]ba.AgentTool` values, each listed once, such as `ba.AgentToolRead`, `ba.AgentToolWriteTodos`, `ba.AgentToolSaveMemory`, or `ba.AgentToolWebSearch`; `nil` leaves the list unchanged and `[]ba.AgentTool{}` clears it. Agent spending limits live on `client.SpendingLimits`. See [Built-in tools](concepts.md#built-in-tools).

### `client.Skills` (both clients)

| Method | Returns |
| --- | --- |
| `Create(agentID, ba.CreateSkillParams{Content})` | `*ba.Skill` (the SDK sends `path: "SKILL.md"`; `Content` starts with YAML frontmatter that sets `name` and `description`) |
| `Upload(agentID, ba.UploadSkillParams{Type, File})` | `*ba.Skill` (`ba.ArchiveTypeZip`, `ba.ArchiveTypeTar`, `ba.ArchiveTypeTarGz`) |
| `List(agentID, ba.ListSkillsParams{Limit, Cursor})` / `All(...)` | `*ba.Page[ba.SkillSummary]` / `iter.Seq2[ba.SkillSummary, error]` |
| `Get(agentID, skillID)` | `*ba.Skill` |
| `Delete(agentID, skillID)` | `error` |
| `ReadFile(agentID, skillID, path)` | `*ba.Download`, an `io.Reader` with `Close`, `ContentType`, and `ContentLength` |
| `ReplaceFile(agentID, skillID, path, content io.Reader)` | `*ba.Skill` |
| `DeleteFile(agentID, skillID, path)` | `*ba.Skill` |
| `Copy(agentID, skillID, ba.CopySkillParams{AgentIDs})` | `[]ba.SkillCopyResult`, one per destination, in request order (`ba.SkillCopyCreated` or `ba.SkillCopyFailed`) |

A `ba.Upload` comes from `ba.UploadFile(path)`, `ba.UploadBytes(name, b)`, or `ba.UploadReader(name, r)`, with `.WithContentType(ct)`. The content type otherwise follows the file name's extension, and a file that does not open fails with `*ba.ArgumentError` before anything is sent.

### `client.Sessions` (both clients)

| Method | Returns |
| --- | --- |
| `List(agentID, ba.ListSessionsParams{UserID, Limit, Cursor})` / `All(...)` | `*ba.Page[ba.SessionSummary]` |
| `ListLatest(ba.ListLatestSessionsParams{UserID, ByAgent, Limit, Cursor})` / `AllLatest(...)` | `*ba.Page[ba.LatestSession]` (`ByAgent: new(true)` gives at most one session per agent: its latest, for an inbox view) |
| `Get(agentID, sessionID)` | `*ba.Session` (`AgentConfig`, `ForkedFrom`) |
| `Fork(agentID, sessionID, ba.ForkSessionParams{MessageID, IdempotencyKey})` | `*ba.Session` for the child |
| `ListMessages(agentID, sessionID, ba.ListSessionMessagesParams{Cursor, After, Limit})` / `AllMessages(...)` | `*ba.SessionMessageList` (`Data`, `NextCursor`, `LatestCursor`) / `iter.Seq2[ba.Message, error]` |
| `ListToolApprovals(agentID, sessionID)` | `*ba.ToolApprovalList` (`Data` of `ba.ToolApproval`, `Continuation`) |
| `SubmitInput(agentID, sessionID, ba.SubmitSessionInputParams{RequestID, Message})` | `*ba.SubmitInputResult` (`Input`, the `ba.SessionInput` receipt, plus `Activity`). Steers the running Turn; fails `steer_not_available` when no Turn can take it |
| `ListInputs(agentID, sessionID, ba.ListSessionInputsParams{IncludeCompleted, Limit, Cursor})` / `AllInputs(...)` | `*ba.SessionInputList` (`Data`, `NextCursor`, `Activity`) |
| `Stop(agentID, sessionID, ba.StopSessionTurnParams{TurnID})` | `*ba.StopResult` (`StoppedTurnID`, `Activity`) as soon as the stop is recorded; keep reading the existing stream until the Turn settles |
| `Delete(agentID, sessionID, ba.DeleteSessionParams{DeleteArtifacts})` | `error` |

`Fork` sends `IdempotencyKey` as the `Idempotency-Key` header and fails client-side with `*ba.ArgumentError` on an empty or non-header-safe key. Reuse the original key after a lost response; a retry returns the same child, and `ba.CaptureResponse` shows `Status` 200 for a replay and 201 for a new child. The child's `ForkedFrom` names the source Session and message. Fork eligibility, retries, and error codes are in [Add a requested fork](recipes/chat-in-your-app.md#add-a-requested-fork).

`ListMessages` returns the newest page in chronological order; pass `NextCursor` back as `Cursor` for earlier pages, and save `LatestCursor` to pass as `After` later for messages that arrived since. Setting both fails with `*ba.ArgumentError`. `AllMessages` keeps the direction: with `After` set it follows newer pages, otherwise older ones. While a Turn runs, `Chat.Send` fails with `session_busy`; steer with `SubmitInput` or hold the message in your own client. A Turn that stopped responding fails `session_turn_unresponsive`; wait out the error's `RetryAfter`, read history, then send again under a new message ID.

`SubmitInput` saves a steer receipt under your `RequestID` before returning, so retry with the same `RequestID` and message; a changed payload fails `input_idempotency_conflict`. Receipt `State` is `accepted`, `delivered`, `committed` (in history), `not_placed` (never ran, safe to resend as chat), or `uncertain` (may have run; never resend automatically). `ListInputs` lists receipts; `IncludeCompleted: new(true)` adds terminal ones, and `Activity` (`idle`, `running`, `stopping`, `approval` with `TurnID`) says what the Session is doing. `Stop` takes `stream.TurnID()` in the client that started the Turn, or `Activity.TurnID` read from `ListInputs`. What each receipt state means and how the client-held queue works are in [Add chat to your app](recipes/chat-in-your-app.md#how-it-works).

### `client.Tasks` (both clients)

| Method | Returns |
| --- | --- |
| `Create(ba.CreateTaskParams{AgentID, Name, Prompt, IdempotencyKey, Schedule, Enabled, Submit, UserID, Metadata})` | `*ba.CreatedTask` (`Task`, `RunID`). A retry with the same key returns the same Task and initial run |
| `List(ba.ListTasksParams{AgentID, UserID, Limit, Cursor})` / `All(...)` | `*ba.Page[ba.TaskListItem]` |
| `Get(taskID)` | `*ba.Task` |
| `Update(taskID, ba.UpdateTaskParams{Name, Prompt, Schedule, Enabled, Metadata})` | `*ba.Task` |
| `Delete(taskID)` | `error`. A queued or running run blocks it |
| `Submit(taskID, ba.SubmitTaskParams{IdempotencyKey})` | `*ba.CreatedTaskRun` (`RunID`) |
| `ListRuns(taskID, ba.ListTaskRunsParams{Limit, Cursor})` / `AllRuns(...)` | `*ba.Page[ba.TaskRun]` |
| `GetRun(taskID, runID)` | `*ba.TaskRun` with `AgentConfig` saved when queued |
| `ListRunMessages(taskID, runID, ba.ListTaskRunMessagesParams{Cursor, After, Limit})` / `AllRunMessages(...)` | `*ba.TaskRunMessageList` (`Data`, `NextCursor`, `LatestCursor`, `Status`, `Error`, `FinishedAt`) |
| `CancelRun(taskID, runID)` | `error` |

`Schedule` is a `ba.Nullable[ba.Schedule]`; Go cannot infer the interface from a variant, so write the type argument: `ba.Value[ba.Schedule](ba.ScheduleCron{Expression: "0 9 * * 1", Timezone: new("Pacific/Auckland"), Stagger: new(5 * time.Minute)})`, `ba.ScheduleInterval{Every: time.Hour}` (at least one minute), or `ba.ScheduleOnce{At: t}`. `ba.Null[ba.Schedule]()` on update removes it. Transcript pages walk backward with `Cursor`; pass `LatestCursor` as `After` to poll for newer messages; never both. `TaskRunID` and `TurnID` are different types.

### `client.Workspaces` (both clients)

`Create` takes `Tier: new(ba.WorkspaceTierCore)` (default) or `ba.WorkspaceTierPlus`; `Update` cannot change it. `client.Agents.Create` with `WorkspaceTier` sets the tier of the new Workspace it creates and is rejected together with `WorkspaceID`, even as `Core`. See [Workspace](concepts.md#workspace) for choosing a tier.

| Method | Returns |
| --- | --- |
| `Create(ba.CreateWorkspaceParams{Tier, Name, UserID, Metadata, NetworkPolicy})` | `*ba.Workspace` |
| `List(ba.ListWorkspacesParams{UserID, Limit, Cursor})` / `All(...)` | `*ba.Page[ba.Workspace]` |
| `Get(workspaceID)` | `*ba.Workspace` |
| `Update(workspaceID, ba.UpdateWorkspaceParams{Name, Metadata, NetworkPolicy})` | `*ba.Workspace` (`Name` is `ba.Nullable[string]`) |
| `Delete(workspaceID)` | `ba.WorkspaceDeletion`: `ba.WorkspaceDeletionCompleted` when it is gone, `ba.WorkspaceDeletionPending` while cleanup continues in the background |

A network policy is `ba.NetworkPolicyUnrestricted{}`, `ba.NetworkPolicyAllowlist{AllowedHosts: hosts}`, or `ba.NetworkPolicyOffline{}`.

### `client.Providers`

| Method | Returns |
| --- | --- |
| `Create(ba.CreateProviderParams{Name, ProviderType, APIKey, BaseURL})` | `*ba.Provider`. `APIKey` is a `ba.Secret` from `ba.NewSecret(key)` and is never returned |
| `List()` | `[]ba.ProviderSummary` |
| `Get(providerID)` | `*ba.Provider` |
| `Update(providerID, ba.UpdateProviderParams{Name})` | `*ba.Provider` |
| `Delete(providerID, ba.DeleteProviderParams{ConfirmSnapshotInvalidation})` | `error` |
| `ListModels(providerID)` | `[]ba.ProviderModel` |
| `ThinkingLevels(providerID, model)` | `*ba.ProviderThinkingLevels` |

`ProviderType` is `ba.ProviderTypeOpenAI`, `ba.ProviderTypeAnthropic`, `ba.ProviderTypeOpenRouter`, `ba.ProviderTypeGoogle`, `ba.ProviderTypeVercelAIGateway`, or `ba.ProviderTypeCustom` (needs `BaseURL: ba.Value("https://...")`).

### `client.MCPConnections`

| Method | Returns |
| --- | --- |
| `Create(ba.CreateMCPConnectionParams{Name, URL, Auth})` | `*ba.MCPConnection`. Secrets are never returned |
| `List()` | `[]ba.MCPConnection` |
| `Get(mcpConnectionID)` | `*ba.MCPConnection` |
| `Update(mcpConnectionID, ba.UpdateMCPConnectionParams{Name})` | `*ba.MCPConnection` |
| `Delete(mcpConnectionID)` | `error` |
| `Test(mcpConnectionID)` | `*ba.MCPConnectionTest` (`OK`; `Server`, `ToolNames`, `Latency`, `ToolCount` when it passed; `Error` when it failed) |
| `Reconnect(mcpConnectionID, ba.ReconnectMCPConnectionParams{URL, Auth})` | `*ba.MCPConnectionReconnectResult` (`Status`, `Connection`) |

`Auth` is a `ba.MCPAuth`, one value per auth type with only the fields that type takes: `ba.MCPAuthNone{}`, `ba.MCPAuthBearer{Token}`, `ba.MCPAuthOAuthAuthorizationCode{ClientID, ClientSecret, Scope}`, or `ba.MCPAuthOAuthClientCredentials{ClientID, ClientSecret, Scope}`; every secret is a `ba.Secret`. A nil `Auth` fails with `*ba.ArgumentError`. Attach a connection to an Agent through `client.Agents.Create` / `Update` `MCPConnectionIDs`. OAuth sign-in for an `oauth_authorization_code` connection happens in the dashboard: a Tenant administrator opens MCP connections, clicks **Connect**, and signs in to the server. The connection stays `needs_auth` until then, and an API key cannot start this sign-in.

### `client.Memories` (both clients)

| Method | Returns |
| --- | --- |
| `Create(agentID, ba.CreateMemoryParams{Text, UserID})` | `*ba.Memory` |
| `List(agentID, ba.ListMemoriesParams{UserID, Search, Limit, Cursor})` / `All(...)` | `*ba.Page[ba.Memory]` |
| `Get(agentID, memoryID)` | `*ba.Memory` |
| `Update(agentID, memoryID, ba.UpdateMemoryParams{Text})` | `*ba.Memory` |
| `Delete(agentID, memoryID)` | `error` |

A `ba.Memory` carries `ID`, `UserID` (empty for a general memory), `Text`, and timestamps including `LastAccessedAt`; `Get` does not touch `LastAccessedAt`, `Update` does. An agent holds at most 500 memories.

### `client.Prompts` (both clients)

| Method | Returns |
| --- | --- |
| `Create(ba.CreatePromptParams{Name, Template, AgentID, UserID, Metadata})` | `*ba.Prompt` |
| `List(ba.ListPromptsParams{AgentID, UserID, Limit, Cursor})` / `All(...)` | `*ba.Page[ba.Prompt]` |
| `Get(promptID)` | `*ba.Prompt` |
| `Update(promptID, ba.UpdatePromptParams{AgentID, Name, Template, Metadata})` | `*ba.Prompt` |
| `Delete(promptID)` | `error` |

`AgentID` is a `ba.Nullable[ba.AgentID]`: `ba.Value(agentID)` links the Prompt, `ba.Null[ba.AgentID]()` unlinks it. Run a saved Prompt with `client.Chat.Send(ctx, agentID, ba.SavedPrompt{ID: promptID, Variables: vars}, ...)` or the other generation methods.

### `client.Artifacts` (both clients)

| Method | Returns |
| --- | --- |
| `List(ba.ListArtifactsParams{AgentID, SessionID, Cursor})` / `All(...)` | `*ba.Page[ba.Artifact]`. The server returns 50 Artifacts per page; follow `NextCursor` or range over `All` |
| `Get(artifactID)` | `*ba.Artifact` |
| `CreateDownloadURL(artifactID)` | `*ba.ArtifactDownloadURL` (`URL`, a `ba.Secret`; `ExpiresAt`; the link works for five minutes without an API key) |
| `Delete(artifactID)` | `error` |

The download link is a credential, so `URL` prints as `[redacted]` under `fmt`, `log/slog`, and `encoding/json`. Read it with `dl.URL.Reveal()` and hand it to the user in a redirect.

### `client.ChatConnections`

| Method | Returns |
| --- | --- |
| `Create(ba.SlackConnection{AgentID, Name, Enabled, ChannelIDs, Credentials: ba.SlackCredentials{BotToken, SigningSecret}})` or `Create(ba.TelegramConnection{AgentID, Name, Enabled, ChatIDs, BusinessMode, Credentials: ba.TelegramCredentials{BotToken}})` | `*ba.ChatConnection`. Credentials are never returned |
| `List()` | `[]ba.ChatConnection` |
| `Get(chatConnectionID)` | `*ba.ChatConnection` |
| `Update(chatConnectionID, ba.UpdateChatConnectionParams{Name, Configuration})` | `*ba.ChatConnection` (`Configuration` is `*ba.ChatConfigurationUpdate{ChannelIDs, ChatIDs, BusinessMode}`) |
| `RotateCredentials(chatConnectionID, ba.SlackCredentials{...}` or `ba.TelegramCredentials{...})` | `*ba.ChatConnection` |
| `CheckHealth(chatConnectionID)` | `*ba.ChatConnection` |
| `Enable(chatConnectionID)` / `Disable(chatConnectionID)` | `*ba.ChatConnection` |
| `Delete(chatConnectionID)` | `error` |
| `ListDeliveries(chatConnectionID, ba.ListChatDeliveriesParams{Limit, Cursor})` / `AllDeliveries(...)` | `*ba.Page[ba.ChatDelivery]` |
| `RepairDelivery(chatConnectionID, deliveryID, ba.RepairChatDeliveryParams{ExpectedAttempt})` | `*ba.ChatDeliveryResult` |

Every bot token and signing secret is a `ba.Secret` built with `ba.NewSecret`. `RepairDelivery` confirms the previous sender has stopped and accepts that the repaired reply may post twice. See [Put your agent in Slack or Telegram](recipes/slack-and-telegram.md).

### `client.ChatDeliveries`

| Method | Returns |
| --- | --- |
| `List(ba.ListTenantChatDeliveriesParams{Status, Since, Limit, Cursor})` / `All(...)` | `*ba.Page[ba.TenantChatDelivery]` |

Failed and ambiguous deliveries across every connection, newest first (an attention feed, not full history). `Status` is a `[]ba.ChatDeliveryStatus` of `ba.ChatDeliveryStatusFailed` and/or `ba.ChatDeliveryStatusAmbiguous` (default both); pending and confirmed are rejected. `Since` is an inclusive `*time.Time` lower bound.

### `client.Usage`, `client.SpendingLimits`, and `client.Tenant`

| Method | Returns |
| --- | --- |
| `Usage.Overview(ba.UsageOverviewParams{DateRange, Limit})` | `*ba.UsageOverview` (totals, daily rows, top breakdowns) |
| `Usage.Get(ba.UsageParams{DateRange, AgentID, SessionID, UserID, GroupBy, Limit})` | `*ba.Usage`; also on `UserClient.Usage` |
| `Usage.ForAgent(agentID, ba.AgentUsageParams{DateRange, SessionID, UserID, GroupBy, Limit})` | `*ba.Usage` |
| `Usage.Sessions(ba.SessionUsageParams{SessionIDs, DateRange})` | `*ba.SessionUsage` (`Data`: one `ba.SessionUsageEntry` per ID; 1 to 100 IDs); also on `UserClient.Usage` |
| `Tenant.Get()` | `*ba.TenantSettings` |
| `Tenant.Update(ba.UpdateTenantParams{Name, MonetizationEnabled, Quota})` | `*ba.TenantSettings`. Turning `MonetizationEnabled` off drops usage events the merchant has not accepted |
| `SpendingLimits.GetTenant()` / `SpendingLimits.UpdateTenant(ba.UpdateSpendingLimitParams{SpendingLimit})` | `*ba.ModelSpendingLimitStatus` |
| `SpendingLimits.GetAgent(agentID)` / `SpendingLimits.UpdateAgent(agentID, ba.UpdateSpendingLimitParams{SpendingLimit})` | `*ba.ModelSpendingLimitStatus`. See [model spending limits](recipes/usage-dashboards.md#model-spending-limits) |

`GroupBy` is `ba.UsageGroupByDay`, `Agent`, `Model`, `Session`, or `User`. `DateRange` is an embedded `*ba.DateRange{From, To}` of `ba.Date{Year, Month, Day}` values; `nil` sends neither bound. `SessionID` and `UserID` filters are `*string`, and `new("")` sends an empty filter that matches usage with no label. `Quota` is a `ba.Nullable[ba.QuotaInput]`; `ba.QuotaInput{ResetDay, MonthlyTokenLimit, MonthlyRequestLimit}` sends `null` for a limit you leave `nil`, which means unlimited, and `ba.Null[ba.QuotaInput]()` removes the quota. `SpendingLimit` is a `*ba.ModelSpendingLimit{AmountUSD, ResetStartDate, ResetInterval}`; `nil` removes the limit.

### `client.MerchantConnection`, `client.MerchantBindings`, `client.MerchantUsageEvents`

Monetization: bill your end users through your own Polar or Dodo account. Setup, guard rules, and delivery states are in [Usage dashboards](recipes/usage-dashboards.md).

| Method | Returns |
| --- | --- |
| `MerchantConnection.Get()` | `*ba.MerchantConnection`, or `nil, nil` when there is none: the one method where a successful call returns no model |
| `MerchantConnection.Create(ba.CreateMerchantConnectionParams{Provider, Environment, Credential, Guard})` | `*ba.MerchantConnection`. `ba.MerchantProviderPolar` or `Dodo`; `ba.MerchantEnvironmentSandbox` or `Live` |
| `MerchantConnection.Update(ba.UpdateMerchantConnectionParams{Credential, Status, Guard})` | `*ba.MerchantConnection` |
| `MerchantConnection.Retire()` | `error`. Stops deliveries |
| `MerchantBindings.List(ba.ListMerchantBindingsParams{UserID, Limit, Cursor})` / `All(...)` | `*ba.MerchantBindingList`. Fails `merchant_connection_not_found` when there is no connection |
| `MerchantBindings.Set(userID string, ba.SetMerchantBindingParams{CustomerID})` | `*ba.MerchantBinding`. The API checks the customer exists at the provider |
| `MerchantBindings.Delete(userID string)` | `error` |
| `MerchantUsageEvents.List(ba.ListMerchantUsageEventsParams{Status, Limit, Cursor})` / `All(...)` | `*ba.MerchantUsageEventList` |
| `MerchantUsageEvents.Get(eventID)` | `*ba.MerchantUsageEvent` (`NextAction` says what to do) |
| `MerchantUsageEvents.Summary(ba.MerchantUsageSummaryParams{Days})` | `*ba.MerchantUsageSummary` (status counts and a daily window; `Days` 1 to 90, default 14) |
| `MerchantUsageEvents.Retry(eventID)` / `Release(eventID)` / `Discard(eventID)` | `*ba.MerchantUsageEvent` |

`Credential` is a `ba.Secret`. `Guard` is a `*ba.MerchantGuard{Enabled, ProductIDs, MeterID}`; a nil `ProductIDs` is sent as `[]`. Turn billing on with `client.Tenant.Update(ctx, ba.UpdateTenantParams{MonetizationEnabled: new(true)})` after the connection exists.

## Partial updates: nil keeps, `Null` sends null

A pointer, slice, map, or `ba.Nullable` field you leave zero is not sent, so the server keeps the current value (or its default on create). A nullable field is a `ba.Nullable[T]`; `ba.Null[T]()` sends JSON `null` and clears it.

```go
// Changes only the instructions. Every other field keeps its value.
_, err := client.Agents.Update(ctx, agentID, ba.UpdateAgentParams{
	Instructions: new("Answer in two sentences."),
})
if err != nil {
	return err
}
// Sends null: back to the Provider's default thinking level.
_, err = client.Agents.Update(ctx, agentID, ba.UpdateAgentParams{
	ThinkingLevel: ba.Null[string](),
})
if err != nil {
	return err
}
```

- Supplied lists and maps replace the old value completely. `Tools`, `MCPConnectionIDs`, `Metadata`, and approval policies are not merged. A `nil` slice leaves the list unchanged; an empty non-nil slice such as `[]ba.AgentTool{}` clears it.
- `SpendingLimits.UpdateTenant(ctx, ba.UpdateSpendingLimitParams{})` with a nil `SpendingLimit` removes a spending limit.
- To forward optional values from your own input, set each field conditionally; there is no catch-all map.

## Pagination

A paginated `List` call returns one `*ba.Page[T]` (`Data`, `NextCursor`; `""` on the last page). `All` returns an `iter.Seq2[T, error]` that walks every page lazily and sends nothing before the first iteration; an error is yielded once and ends the loop, breaking out stops fetching, and ranging again starts over. Set `Cursor` in the params to resume from a saved cursor.

```go
for session, err := range client.Sessions.All(ctx, agentID, ba.ListSessionsParams{}) {
	if err != nil {
		return err
	}
	fmt.Println(session.ID, session.MessageCount)
}

params := ba.ListTasksParams{Limit: new(20)}
for {
	page, err := client.Tasks.List(ctx, params)
	if err != nil {
		return err
	}
	for _, task := range page.Data {
		fmt.Println(task.ID, task.Name)
	}
	if page.NextCursor == "" {
		break
	}
	params.Cursor = new(page.NextCursor)
}
```

`client.Providers.List`, `client.MCPConnections.List`, and `client.ChatConnections.List` return every item in one slice and have no `All`. `client.Tasks.ListRunMessages` also returns `LatestCursor`; pass it as `After` later to fetch only newer messages. Setting `Cursor` and `After` together fails with `*ba.ArgumentError`.

For server-enforced end-user scope, use [`client.ForUser(verifiedUserID)`](#end-user-scope). A `UserID` field alone is Attribution.

## Errors

Every failure a call can produce is one of these error types. Match them with `errors.As`.

| Type | Returned when | Useful fields |
| --- | --- | --- |
| `*ba.APIError` | The API returns an error status | `Status`, `Code`, `Message`, `Details`, `Param`, `RetryAfter`, `Meta.RequestID`, `Meta.Header`, `Body` |
| `*ba.ConnectionError` | The network fails before a complete response, including your own `ctx` cancellation or deadline, which `Err` wraps | `OperationID`, `Err` |
| `*ba.TimeoutError` | The SDK's own timeout elapsed. It matches `errors.Is(err, context.DeadlineExceeded)` | `OperationID`, `After` |
| `*ba.StreamError` | A stream fails after headers arrive or ends early | `Kind` (`ba.StreamRead`, `ba.StreamIncomplete`, `ba.StreamFunctionCall`, ...), `Meta`, `Err` |
| `*ba.ObjectError` | Structured output is truncated, invalid, or mismatched | `Kind`, `Text`, `Meta`, `Err` |
| `*ba.DecodeError` | A 2xx body does not match the response model | `OperationID`, `RequestID`, `Err` |
| `*ba.CredentialEchoError` | A response echoed credential material back; the body was discarded | `OperationID`, `RequestID`, `Field` |
| `*ba.ArgumentError` | A client-side argument the types could not rule out, checked before anything is sent | `Name`, `Reason`, `Err` |
| `ba.ErrMissingAPIKey`, `ba.ErrInvalidAPIKey`, `ba.ErrInvalidBaseURL`, `ba.ErrInvalidHeader`, `ba.ErrConflictingOptions`, `ba.ErrInvalidUserID` | A client configuration problem in `NewClient` or `ForUser`, before any request | match with `errors.Is` |

`Code` is a `ba.ErrorCode`, an open string type with a constant per documented code, such as `ba.ErrorCodeNotFound` or `ba.ErrorCodeSessionBusy`. A code this version does not know compares as itself, so keep a default branch. Branch on the code, not the message. `Error()` reads `blazingagents: getAgent: 404 not_found: Agent not found (request req_123)`.

```go
agent, err := client.Agents.Get(ctx, agentID)
var apiErr *ba.APIError
var streamErr *ba.StreamError
switch {
case err == nil:
	fmt.Println(agent.Name)
case errors.As(err, &apiErr) && apiErr.Code == ba.ErrorCodeNotFound:
	// Branch on the stable code, not the message.
	fmt.Println("No such Agent")
case errors.As(err, &apiErr):
	fmt.Println(apiErr.Status, apiErr.Code, apiErr.Meta.RequestID, apiErr.RetryAfter)
case errors.As(err, &streamErr):
	fmt.Println("Stream failed", streamErr.Meta.RequestID)
case errors.Is(err, context.DeadlineExceeded):
	fmt.Println("Could not reach Blazing Agents in time")
default:
	return err
}
```

`ba.CaptureResponse(&meta)` fills a `ba.ResponseMeta` with the response `Status`, `Header`, and server `RequestID` for any call; streams expose the same through `Meta()`. Include the request ID when you contact support. Response headers in `Meta.Header` and every error message have submitted secrets replaced with `[redacted]`.

## Gotchas

- Chat on a busy Session fails `session_busy`. Steer the running Turn with `client.Sessions.SubmitInput`, or keep the message in your own queue and send it as ordinary chat once the Turn settles. A Turn that stopped responding fails `session_turn_unresponsive` with `RetryAfter`; wait it out, read history, then send again under a new message ID.
- Reading a `*ba.ChatStream` into memory before replying breaks streaming for your user. Use `WriteTo` on the response writer, which flushes after each event.
- Losing `stream.SessionID()` starts a fresh Session on every message. Save it with your user before you return the response.
- `ForUser` returns an error: handle `ba.ErrInvalidUserID` instead of ignoring it for an ID taken from a request.
- Agent and Prompt names can repeat. Read every page before resolving a name to an ID; reject multiple exact matches.
- `Agents.Delete` takes `ba.DeleteAgentParams{IncludeArtifacts}` and `Sessions.Delete` takes `ba.DeleteSessionParams{DeleteArtifacts}`; the flag is always sent, so decide explicitly whether published files go too.
- A `ba.Secret` prints as `[redacted]` everywhere, including `%v`, `%+v`, `slog`, and JSON. Two secrets compare equal only when one is a copy of the other; compare `Reveal()` results instead. Never put a secret in a header, name, or URL field.
- Response integers are `int64` and timestamps are `time.Time`; request integers are `int`, so `new(25)` works for every `Limit`.
- Enums are open string types and unions have an `Unknown` variant (`ba.UnknownSchedule`, `ba.UnknownToolReference`, ...) that round-trips unchanged, so a type switch over a union needs a default branch.

## Go deeper

- [Go SDK repository](https://github.com/blazingagents/golang-sdk)
- [Error codes](https://docs.blazingagents.com/api-reference/protocols/errors)
- [Connect Blazing Agents to your app](https://docs.blazingagents.com/getting-started/connect-your-app)
- [Add chat to your app](recipes/chat-in-your-app.md) for a full `net/http` relay endpoint
