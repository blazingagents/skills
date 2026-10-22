# Add chat to your app: Go code

The Go code for the steps of [Add chat to your app](chat-in-your-app.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Install the module

```bash
go get github.com/blazingagents/golang-sdk@latest
```

`client.ForUser(userID)` returns a `*ba.UserClient` that sends the scope on every request. `stream.SetRelayHeaders(w.Header())` sets the stream headers and `stream.WriteTo(w)` relays and flushes each event; copy the `Location` header yourself on the first Turn. The SDK rejects an empty, `.`, or `..` path value as `*ba.ArgumentError`, so a browser ID cannot leave its path segment.

## Step 2: Add the backend

```go
package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	ba "github.com/blazingagents/golang-sdk"
)

type chatBody struct {
	Message   json.RawMessage   `json:"message"`
	Messages  []json.RawMessage `json:"messages"`
	SessionID ba.SessionID      `json:"sessionId"`
	MessageID string            `json:"messageId"`
	Trigger   string            `json:"trigger"` // submit-message or regenerate-message
}

func currentUser(r *http.Request) (string, bool) {
	// Your sign-in check: verify the session token and return its user ID.
	return "", false
}

func agentForUser(userID string) ba.AgentID {
	// Read this user's Agent ID from trusted backend state.
	return "ag_0123456789abcdef"
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

func relay(w http.ResponseWriter, stream *ba.ChatStream, newSession bool) {
	defer stream.Close()
	stream.SetRelayHeaders(w.Header()) // content type, no-cache, x-vercel-ai-ui-message-stream, x-ba-turn-id
	if newSession {
		w.Header().Set("Location", stream.Meta().Header.Get("Location"))
	}
	if _, err := stream.WriteTo(w); err != nil {
		log.Printf("relay ended: %v", err)
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

func failure(w http.ResponseWriter, err error) {
	var apiErr *ba.APIError
	var argErr *ba.ArgumentError
	switch {
	case errors.As(err, &argErr): // an invalid sessionId never reaches the URL
		http.Error(w, "Invalid request.", http.StatusBadRequest)
	case errors.As(err, &apiErr):
		writeJSON(w, apiErr.Status, map[string]any{"error": map[string]string{"code": string(apiErr.Code)}})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": map[string]string{"code": "upstream_error"}})
	}
}

func history(client *ba.Client) http.HandlerFunc {
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
		params := ba.ListSessionMessagesParams{Limit: new(200)}
		if cursor := r.URL.Query().Get("cursor"); cursor != "" {
			params.Cursor = &cursor
		}
		sessionID := ba.SessionID(r.URL.Query().Get("sessionId"))
		page, err := scoped.Sessions.ListMessages(r.Context(), agentForUser(userID), sessionID, params)
		if err != nil {
			failure(w, err)
			return
		}
		var next any
		if page.NextCursor != "" {
			next = page.NextCursor
		}
		writeJSON(w, http.StatusOK, map[string]any{"messages": page.Data, "nextCursor": next})
	}
}

func chat(client *ba.Client) http.HandlerFunc {
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
		var body chatBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "Invalid message.", http.StatusBadRequest)
			return
		}
		ctx := r.Context()
		agentID := agentForUser(userID)

		var role struct {
			Role string `json:"role"`
		}
		json.Unmarshal(body.Message, &role)
		if body.Messages == nil && role.Role == "assistant" {
			// The frontend posts the answered assistant message; its tool parts
			// after the last step-start carry the round's decisions.
			decisions := approvalDecisions(body.Message)
			if body.SessionID == "" || len(decisions) == 0 {
				http.Error(w, "Invalid approval.", http.StatusBadRequest)
				return
			}
			stream, err := scoped.Chat.Continue(ctx, agentID, body.SessionID, decisions, ba.ContinueParams{})
			if err != nil {
				failure(w, err)
				return
			}
			relay(w, stream, false)
			return
		}

		raw := body.Messages
		if raw == nil && body.Message != nil {
			raw = []json.RawMessage{body.Message}
		}
		messages := make([]ba.UserMessage, 0, len(raw))
		for _, item := range raw {
			var message ba.UserMessage // UnmarshalJSON requires role user, an id and parts
			if err := json.Unmarshal(item, &message); err != nil {
				http.Error(w, "Invalid message.", http.StatusBadRequest)
				return
			}
			messages = append(messages, message)
		}
		if len(messages) == 0 {
			http.Error(w, "Invalid message.", http.StatusBadRequest)
			return
		}
		params := ba.ChatParams{SessionID: body.SessionID}

		var stream *ba.ChatStream
		switch {
		case body.Messages != nil:
			// Waiting messages go out as one batch once the Session is idle.
			if body.SessionID == "" {
				http.Error(w, "A batch needs a Session.", http.StatusBadRequest)
				return
			}
			stream, err = scoped.Chat.Send(ctx, agentID, ba.Messages(messages[0], messages[1:]...), params)
		case body.SessionID != "" && body.Trigger == "regenerate-message":
			var regenerate ba.RegenerateParams
			if body.MessageID != "" {
				regenerate.MessageID = new(body.MessageID)
			}
			stream, err = scoped.Chat.Regenerate(ctx, agentID, body.SessionID, messages[0], regenerate)
		default:
			stream, err = scoped.Chat.Send(ctx, agentID, ba.Messages(messages[0]), params)
		}
		if err != nil {
			failure(w, err)
			return
		}
		relay(w, stream, body.SessionID == "")
	}
}

func main() {
	client, err := ba.NewClient() // reads BLAZING_AGENTS_API_KEY
	if err != nil {
		log.Fatal(err)
	}
	http.Handle("POST /api/chat", chat(client))
	http.Handle("GET /api/chat/history", history(client))
	log.Fatal(http.ListenAndServe(":3000", nil))
}
```

## Step 3: Add the Session endpoints

```go
package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	ba "github.com/blazingagents/golang-sdk"
)

type steerBody struct {
	SessionID ba.SessionID   `json:"sessionId"`
	RequestID string         `json:"requestId"`
	Message   ba.UserMessage `json:"message"`
}

type stopBody struct {
	SessionID ba.SessionID `json:"sessionId"`
	TurnID    ba.TurnID    `json:"turnId"`
}

func currentUser(r *http.Request) (string, bool) {
	// Your sign-in check: verify the session token and return its user ID.
	return "", false
}

func agentForUser(userID string) ba.AgentID {
	// Read this user's Agent ID from trusted backend state.
	return "ag_0123456789abcdef"
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

func failure(w http.ResponseWriter, err error) {
	var apiErr *ba.APIError
	var argErr *ba.ArgumentError
	switch {
	case errors.As(err, &argErr): // an invalid sessionId, turnId or requestId never reaches the URL
		http.Error(w, "Invalid request.", http.StatusBadRequest)
	case errors.As(err, &apiErr):
		writeJSON(w, apiErr.Status, map[string]any{"error": map[string]string{"code": string(apiErr.Code)}})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": map[string]string{"code": "upstream_error"}})
	}
}

// scopedClient derives the signed-in user's client, or answers 401.
func scopedClient(client *ba.Client, w http.ResponseWriter, r *http.Request) (*ba.UserClient, string, bool) {
	userID, ok := currentUser(r)
	if !ok {
		http.Error(w, "Sign in first.", http.StatusUnauthorized)
		return nil, "", false
	}
	scoped, err := client.ForUser(userID)
	if err != nil {
		http.Error(w, "Sign in first.", http.StatusUnauthorized)
		return nil, "", false
	}
	return scoped, userID, true
}

func session(client *ba.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scoped, userID, ok := scopedClient(client, w, r)
		if !ok {
			return
		}
		// Terminal receipts too: IncludeCompleted returns committed and
		// not_placed inputs, and Activity says what the Session is doing.
		sessionID := ba.SessionID(r.URL.Query().Get("sessionId"))
		page, err := scoped.Sessions.ListInputs(r.Context(), agentForUser(userID), sessionID,
			ba.ListSessionInputsParams{IncludeCompleted: new(true)})
		if err != nil {
			failure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, page)
	}
}

func steer(client *ba.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scoped, userID, ok := scopedClient(client, w, r)
		if !ok {
			return
		}
		var body steerBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "Invalid message.", http.StatusBadRequest)
			return
		}
		receipt, err := scoped.Sessions.SubmitInput(r.Context(), agentForUser(userID), body.SessionID,
			ba.SubmitSessionInputParams{RequestID: body.RequestID, Message: body.Message})
		if err != nil {
			failure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, receipt)
	}
}

func stop(client *ba.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scoped, userID, ok := scopedClient(client, w, r)
		if !ok {
			return
		}
		var body stopBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "Invalid request.", http.StatusBadRequest)
			return
		}
		result, err := scoped.Sessions.Stop(r.Context(), agentForUser(userID), body.SessionID,
			ba.StopSessionTurnParams{TurnID: body.TurnID})
		if err != nil {
			failure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func main() {
	client, err := ba.NewClient() // reads BLAZING_AGENTS_API_KEY
	if err != nil {
		log.Fatal(err)
	}
	http.Handle("GET /api/chat/session", session(client))
	http.Handle("POST /api/chat/steer", steer(client))
	http.Handle("POST /api/chat/stop", stop(client))
	log.Fatal(http.ListenAndServe(":3000", nil))
}
```
