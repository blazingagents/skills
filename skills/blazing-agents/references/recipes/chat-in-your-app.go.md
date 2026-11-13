# Add chat to your app: Go code

The Go code for the steps of [Add chat to your app](chat-in-your-app.md). Read that file first: it explains each step, its decisions, and its gotchas. Step 3, the browser chat, is the same for every backend.

## Step 1: Install the module

```bash
go get github.com/blazingagents/golang-sdk@latest
```

## Step 2: Add the relay

`ba.NewChatRelay(client, resolveContext)` returns the `http.Handler` that answers the browser's `chat`, `history`, and `steer` requests by the [browser relay contract](https://github.com/blazingagents/typescript-sdk/blob/main/docs/relay-contract.md). For each request it calls `resolveContext`, which returns a `*ba.RelayContext` with the signed-in user and their Agent, or `nil, nil`, which the relay answers with `401`. The relay then sends every API request through `client.ForUser(userID)`, and never reads the user or the Agent from the request body. An error from `resolveContext` keeps its status and code when it is an `*ba.APIError`.

```go
package main

import (
	"context"
	"log"
	"net/http"
	"os"

	ba "github.com/blazingagents/golang-sdk"
)

func signedInUserID(r *http.Request) (string, bool) {
	// Your sign-in check: verify the session token and return its user ID.
	return "", false
}

// agentFor returns the user's own Agent, which comes with its own Workspace.
func agentFor(ctx context.Context, client *ba.Client, userID string) (ba.AgentID, error) {
	scoped, err := client.ForUser(userID)
	if err != nil {
		return "", err
	}
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

func main() {
	client, err := ba.NewClient() // reads BLAZING_AGENTS_API_KEY
	if err != nil {
		log.Fatal(err)
	}
	resolveContext := func(r *http.Request) (*ba.RelayContext, error) {
		userID, ok := signedInUserID(r)
		if !ok {
			return nil, nil
		}
		agentID, err := agentFor(r.Context(), client, userID)
		if err != nil {
			return nil, err
		}
		return &ba.RelayContext{AgentID: agentID, UserID: userID}, nil
	}
	http.Handle("POST /api/chat", ba.NewChatRelay(client, resolveContext))
	log.Fatal(http.ListenAndServe(":3000", nil))
}
```

For backend functions and attribution, set `Functions` and `Metadata` on the `RelayContext`. For a relay on another origin, send `Access-Control-Expose-Headers: Location, X-Request-Id`, so the browser can read the new Session ID.
