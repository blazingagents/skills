# Let a chat agent call your backend functions: Go code

The Go code for the steps of [Let a chat agent call your backend functions](backend-functions.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Add the functions inside your chat route, after authenticating the request, so every handler closes over the verified user

```go
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	ba "github.com/blazingagents/golang-sdk"
)

type OrderInput struct {
	OrderID string `json:"orderId"`
}

type chatBody struct {
	Message   ba.UserMessage `json:"message"`
	SessionID ba.SessionID   `json:"sessionId"` // "" starts a Session
}

func currentUser(r *http.Request) (string, bool) {
	// Your sign-in check: verify the session token and return its user ID.
	return "", false
}

func agentForUser(userID string) ba.AgentID {
	// Read this user's Agent ID from trusted backend state.
	return "ag_0123456789abcdef"
}

func findOrder(ctx context.Context, userID, orderID string) (map[string]any, error) {
	// Your database lookup, scoped to this user.
	return nil, nil
}

func chat(client *ba.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := currentUser(r)
		if !ok {
			http.Error(w, "Sign in first.", http.StatusUnauthorized)
			return
		}
		var body chatBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "Invalid message.", http.StatusBadRequest)
			return
		}

		functions, err := ba.NewFunctions(ba.Function("orderLookup",
			"Look up one of the signed-in user's orders by ID.",
			func(ctx context.Context, call ba.FunctionCall, in OrderInput) (any, error) {
				// Queries only this user's rows. ctx ends at the call's deadline or
				// when the stream closes; call.ID names this one execution.
				order, err := findOrder(ctx, userID, in.OrderID)
				if err != nil {
					return nil, err
				}
				if order == nil {
					return map[string]bool{"found": false}, nil
				}
				return order, nil
			}))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		scoped, err := client.ForUser(userID)
		if err != nil {
			http.Error(w, "Sign in first.", http.StatusUnauthorized)
			return
		}
		stream, err := scoped.Chat.Send(r.Context(), agentForUser(userID), ba.Messages(body.Message), ba.ChatParams{
			SessionID: body.SessionID,
			Functions: functions,
		})
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
	client, err := ba.NewClient() // reads BLAZING_AGENTS_API_KEY
	if err != nil {
		log.Fatal(err)
	}
	http.Handle("POST /api/chat", chat(client))
	log.Fatal(http.ListenAndServe(":3000", nil))
}
```

## Step 2: Continue with the functions after an approval pause

```go
chatFunctionsFor := func(userID string) (*ba.Functions, error) {
	// The same functions as the chat route, built for the Session's owner.
	return ba.NewFunctions()
}

sessionOwnerID := "user_123" // the Session's owner, from your records
decisions := []ba.ToolApprovalDecision{ba.Approve("apr_0123456789abcdef")}

functions, err := chatFunctionsFor(sessionOwnerID)
if err != nil {
	return err
}
scoped, err := client.ForUser(sessionOwnerID)
if err != nil {
	return err
}
stream, err := scoped.Chat.Continue(ctx, agentID, sessionID, decisions, ba.ContinueParams{Functions: functions})
if err != nil {
	return err
}
defer stream.Close()
// In an http.Handler: stream.SetRelayHeaders(w.Header()), then stream.WriteTo(w).
for _, err := range stream.Events() {
	if err != nil {
		return err
	}
}
```
