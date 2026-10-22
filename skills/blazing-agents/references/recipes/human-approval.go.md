# Require approval before your agent runs a tool: Go code

The Go code for the steps of [Require approval before your agent runs a tool](human-approval.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Set the policies

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

## Step 2: After a chat stream ends, list the Session's approvals on your backend and send the pending ones to the reviewer

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

## Step 3: Send the complete round of decisions in one call

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
