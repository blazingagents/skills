# Give your agent your own tools through MCP: Go code

The Go code for the steps of [Give your agent your own tools through MCP](external-tools-mcp.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Create the Connection once, on your backend

```go
connection, err := client.MCPConnections.Create(ctx, ba.CreateMCPConnectionParams{
	Name: "Customer tools",
	URL:  "https://mcp.example.com/v1",
	Auth: ba.MCPAuthBearer{Token: ba.NewSecret(os.Getenv("CUSTOMER_MCP_TOKEN"))},
})
if err != nil {
	return err
}
fmt.Println(connection.ID, connection.Status)
```

## Step 3: Test the Connection, attach it to the Agent, and choose what end-user context the server receives

```go
connectionID := ba.MCPConnectionID("mcp_0123456789abcdef")

test, err := client.MCPConnections.Test(ctx, connectionID)
if err != nil {
	return err
}
if !test.OK {
	return fmt.Errorf("%s: %s", test.Error.Code, test.Error.Message)
}
if !slices.Contains(test.ToolNames, "lookup_customer") {
	return fmt.Errorf("expected lookup_customer, got %v", test.ToolNames)
}

agent, err := client.Agents.Get(ctx, agentID)
if err != nil {
	return err
}
if !slices.Contains(agent.MCPConnectionIDs, connectionID) {
	_, err = client.Agents.Update(ctx, agentID, ba.UpdateAgentParams{
		MCPConnectionIDs: append(agent.MCPConnectionIDs, connectionID),
	})
	if err != nil {
		return err
	}
}

_, err = client.Agents.UpdateMCPAttachment(ctx, agentID, connectionID, ba.UpdateMCPAttachmentParams{
	ForwardUserID:         new(true),
	ForwardedMetadataKeys: []string{"plan"},
})
if err != nil {
	return err
}
```

## Step 4: Run a Turn that needs the tool, then read the saved Session to confirm the call

```go
scoped, err := client.ForUser("user_123") // the verified signed-in user
if err != nil {
	return err
}
stream, err := scoped.Chat.Send(ctx, agentID,
	ba.Messages(ba.TextMessage("Look up customer 42 and summarize their account.")),
	ba.ChatParams{Metadata: ba.Metadata{"plan": "pro"}})
if err != nil {
	return err
}
defer stream.Close()
chatSessionID := stream.SessionID()
for _, err := range stream.Events() {
	if err != nil {
		return err
	}
	// Drain the stream; in an app, relay the raw bytes to the browser instead.
}

page, err := scoped.Sessions.ListMessages(ctx, agentID, chatSessionID, ba.ListSessionMessagesParams{})
if err != nil {
	return err
}
called := false
for _, message := range page.Data {
	for _, raw := range message.Parts {
		var part struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(raw, &part) == nil && strings.Contains(part.Type, "lookup_customer") {
			called = true
		}
	}
}
if called {
	fmt.Println(chatSessionID, "MCP tool was called")
} else {
	fmt.Println(chatSessionID, "MCP tool was not called")
}
```
