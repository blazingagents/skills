# Add chat to your app: Go code

The Go code for the steps of [Add chat to your app](chat-in-your-app.md). Read that file first: it explains each step, its decisions, and its gotchas. Step 3, the React chat, is the same for every backend.

## Step 1: Install the module

```bash
go get github.com/blazingagents/golang-sdk@latest
```

The Go SDK has no relay helper, so the backend implements the [browser relay contract](https://github.com/blazingagents/typescript-sdk/blob/main/docs/relay-contract.md) that `useBlazingAgentsChat` speaks. Every request is a JSON `POST` to one route, and its `op` selects the operation:

| `op` | Body | Scoped client call | Answer |
| --- | --- | --- | --- |
| `chat` | `message`, and optional `sessionId`, `messageId`, `trigger` | `Chat.Send` or `Chat.Regenerate` for a user message, `Chat.Continue` for an assistant message that answers an approval round | The stream, with the `Location` header on a new Session |
| `history` | `sessionId`, optional `cursor` | `Sessions.ListMessages` with `Limit` 200 | `200` with `{"data": [...], "nextCursor": ...}`: one page, forwarded as it is |
| `steer` | `sessionId`, `requestId`, `message` | `Sessions.SubmitInput` | `202` with `{"state": ...}` |

`client.ForUser(userID)` returns a `*ba.UserClient` that sends the scope on every request. `stream.SetRelayHeaders(w.Header())` sets the stream headers, and `stream.WriteTo(w)` relays and flushes each event. The SDK rejects an empty, `.`, or `..` path value as `*ba.ArgumentError`, so a browser ID cannot leave its path segment. Every error body is `{"error": {"code": ..., "message": ...}}`, with the API's status and code when the API refused the call. The browser reads the remaining history pages itself and validates the messages, so the relay forwards one page without a paging loop.

## Step 2: Add the relay

```go
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"

	ba "github.com/blazingagents/golang-sdk"
)

// relayRequest holds the fields of every op; each op reads its own.
type relayRequest struct {
	Op        string          `json:"op"` // chat, history, or steer
	SessionID ba.SessionID    `json:"sessionId"`
	Message   json.RawMessage `json:"message"`
	MessageID string          `json:"messageId"`
	Trigger   string          `json:"trigger"` // submit-message or regenerate-message
	Cursor    string          `json:"cursor"`
	RequestID string          `json:"requestId"`
}

func signedInUserID(r *http.Request) (string, bool) {
	// Your sign-in check: verify the session token and return its user ID.
	return "", false
}

// agentFor returns the user's own Agent, which comes with its own Workspace.
func agentFor(ctx context.Context, scoped *ba.UserClient) (ba.AgentID, error) {
	page, err := scoped.Agents.List(ctx, ba.ListAgentsParams{Limit: new(1)})
	if err != nil {
		return "", err
	}
	if len(page.Data) > 0 {
		return page.Data[0].ID, nil
	}
	agent, err := scoped.Agents.Create(ctx, ba.CreateAgentParams{
		Name:       "Chat assistant",
		ProviderID: ba.Value(ba.ProviderID(os.Getenv("BLAZING_AGENTS_PROVIDER_ID"))),
		Model:      ba.Value("openai/gpt-6-luna"),
	})
	if err != nil {
		return "", err
	}
	return agent.ID, nil
}

// approvalDecisions reads the round's decisions: answered tool parts after the last step-start.
func approvalDecisions(message json.RawMessage) []ba.ToolApprovalDecision {
	var assistant struct {
		Parts []struct {
			Type     string `json:"type"`
			State    string `json:"state"`
			Approval *struct {
				ID       ba.ApprovalID `json:"id"`
				Approved bool          `json:"approved"`
				Reason   string        `json:"reason"`
			} `json:"approval"`
		} `json:"parts"`
	}
	if json.Unmarshal(message, &assistant) != nil {
		return nil
	}
	start := 0
	for i, part := range assistant.Parts {
		if part.Type == "step-start" {
			start = i + 1
		}
	}
	var decisions []ba.ToolApprovalDecision
	for _, part := range assistant.Parts[start:] {
		if part.State != "approval-responded" || part.Approval == nil {
			continue
		}
		d := ba.Deny(part.Approval.ID, part.Approval.Reason) // "" sends no reason
		if part.Approval.Approved {
			d = ba.Approve(part.Approval.ID)
			if part.Approval.Reason != "" {
				d.Reason = new(part.Approval.Reason)
			}
		}
		decisions = append(decisions, d)
	}
	return decisions
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func failure(w http.ResponseWriter, err error) {
	var apiErr *ba.APIError
	var argErr *ba.ArgumentError
	var streamErr *ba.StreamError
	var connErr *ba.ConnectionError
	switch {
	case errors.As(err, &argErr): // an invalid sessionId never reaches the URL
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid request body.")
	case errors.As(err, &apiErr):
		if apiErr.Meta.RequestID != "" {
			w.Header().Set("X-Request-Id", apiErr.Meta.RequestID)
		}
		writeError(w, apiErr.Status, string(apiErr.Code), apiErr.Message)
	case errors.As(err, &streamErr):
		writeError(w, http.StatusBadGateway, "stream_error", "The stream failed.")
	case errors.As(err, &connErr):
		writeError(w, http.StatusBadGateway, "network_error", "Unable to reach Blazing Agents.")
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "Internal error.")
	}
}

func relayChat(w http.ResponseWriter, r *http.Request, scoped *ba.UserClient, agentID ba.AgentID, body relayRequest) error {
	var role struct {
		Role string `json:"role"`
	}
	json.Unmarshal(body.Message, &role)
	var stream *ba.ChatStream
	var err error
	switch {
	case role.Role == "assistant":
		decisions := approvalDecisions(body.Message)
		if body.SessionID == "" || len(decisions) == 0 {
			writeError(w, http.StatusBadRequest, "invalid_request", "Invalid approval.")
			return nil
		}
		stream, err = scoped.Chat.Continue(r.Context(), agentID, body.SessionID, decisions, ba.ContinueParams{})
	default:
		var message ba.UserMessage // UnmarshalJSON requires role user, an id and parts
		if err := json.Unmarshal(body.Message, &message); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", "Invalid chat message.")
			return nil
		}
		if body.SessionID != "" && body.Trigger == "regenerate-message" {
			var regenerate ba.RegenerateParams
			if body.MessageID != "" {
				regenerate.MessageID = new(body.MessageID)
			}
			stream, err = scoped.Chat.Regenerate(r.Context(), agentID, body.SessionID, message, regenerate)
		} else {
			stream, err = scoped.Chat.Send(r.Context(), agentID, ba.Messages(message), ba.ChatParams{SessionID: body.SessionID})
		}
	}
	if err != nil {
		return err
	}
	defer stream.Close()
	stream.SetRelayHeaders(w.Header()) // content type, no-cache, x-vercel-ai-ui-message-stream, x-ba-turn-id
	if location := stream.Meta().Header.Get("Location"); location != "" {
		w.Header().Set("Location", location)
	}
	if _, err := stream.WriteTo(w); err != nil {
		log.Printf("relay ended: %v", err)
	}
	return nil
}

func relayHistory(w http.ResponseWriter, r *http.Request, scoped *ba.UserClient, agentID ba.AgentID, body relayRequest) error {
	params := ba.ListSessionMessagesParams{Limit: new(200)}
	if body.Cursor != "" {
		params.Cursor = &body.Cursor
	}
	page, err := scoped.Sessions.ListMessages(r.Context(), agentID, body.SessionID, params)
	if err != nil {
		return err
	}
	var next any // null on the oldest page
	if page.NextCursor != "" {
		next = page.NextCursor
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": page.Data, "nextCursor": next})
	return nil
}

func relaySteer(w http.ResponseWriter, r *http.Request, scoped *ba.UserClient, agentID ba.AgentID, body relayRequest) error {
	var message ba.UserMessage
	if err := json.Unmarshal(body.Message, &message); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Steering requires a user message.")
		return nil
	}
	receipt, err := scoped.Sessions.SubmitInput(r.Context(), agentID, body.SessionID,
		ba.SubmitSessionInputParams{RequestID: body.RequestID, Message: message})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"state": receipt.Input.State})
	return nil
}

var ops = map[string]func(http.ResponseWriter, *http.Request, *ba.UserClient, ba.AgentID, relayRequest) error{
	"chat":    relayChat,
	"history": relayHistory,
	"steer":   relaySteer,
}

func relay(client *ba.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := signedInUserID(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Authentication required.")
			return
		}
		scoped, err := client.ForUser(userID)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Authentication required.")
			return
		}
		var body relayRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || ops[body.Op] == nil {
			writeError(w, http.StatusBadRequest, "invalid_request", "Invalid request body.")
			return
		}
		agentID, err := agentFor(r.Context(), scoped)
		if err == nil {
			err = ops[body.Op](w, r, scoped, agentID, body)
		}
		if err != nil {
			failure(w, err)
		}
	}
}

func main() {
	client, err := ba.NewClient() // reads BLAZING_AGENTS_API_KEY
	if err != nil {
		log.Fatal(err)
	}
	http.Handle("POST /api/chat", relay(client))
	log.Fatal(http.ListenAndServe(":3000", nil))
}
```

`encoding/json` ignores body keys it does not know, as the contract requires. For a relay on another origin, send `Access-Control-Expose-Headers: Location, X-Request-Id`, so the browser can read the new Session ID.
