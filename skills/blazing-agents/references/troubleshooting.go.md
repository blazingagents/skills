# Troubleshoot a Blazing Agents integration: Go code

The Go code for the steps of [Troubleshoot a Blazing Agents integration](troubleshooting.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Read the error first

```go
agent, err := client.Agents.Get(ctx, agentID)
if err != nil {
	var apiErr *ba.APIError
	if errors.As(err, &apiErr) {
		log.Println(apiErr.Code, apiErr.Status, apiErr.Meta.RequestID, agentID)
	}
	return err
}
fmt.Println(agent.Name)
```

## MCP authorization missing

```go
connectionID := ba.MCPConnectionID("mcp_0123456789abcdef")
connection, err := client.MCPConnections.Get(ctx, connectionID)
if err != nil {
	return err
}
fmt.Println(connection.Status)
if connection.LastAuthErrorCode != nil {
	fmt.Println(*connection.LastAuthErrorCode)
}
test, err := client.MCPConnections.Test(ctx, connectionID)
if err != nil {
	return err
}
if !test.OK {
	fmt.Println(test.Error.Code, test.Error.Message)
}
```

## Chat Connection health unknown

```go
connection, err := client.ChatConnections.CheckHealth(ctx, ba.ChatConnectionID("cc_0123456789abcdef"))
if err != nil {
	return err
}
fmt.Println(connection.Enabled, connection.Health.TokenValid)
for _, check := range connection.Health.Checks {
	if check.Status == ba.ChatHealthCheckStatusPass {
		continue
	}
	subject := ""
	if check.Subject != nil {
		subject = *check.Subject
	}
	fmt.Println(check.Code, check.Status, subject)
}
```
