# Let an Agent search the web: Go code

The Go code for the steps of [Let an Agent search the web](web-search.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Create an Agent with `web_search`

```go
agent, err := client.Agents.Create(ctx, ba.CreateAgentParams{
	Name:       "Research assistant",
	ProviderID: ba.Value(ba.ProviderID("prv_0123456789abcdef")),
	Model:      ba.Value("openai/gpt-6-luna"),
	Instructions: new("Search the web only for facts that may have changed recently. " +
		"Use at most three searches per answer. " +
		"List the URLs you relied on at the end."),
	Tools: []ba.AgentTool{ba.AgentToolWebSearch},
})
if err != nil {
	return err
}
fmt.Println(agent.ID)
```

## Step 2: To add web search to an existing Agent, read its `tools` and send the whole list back with `web_search` added

```go
agent, err := client.Agents.Get(ctx, agentID)
if err != nil {
	return err
}
if !slices.Contains(agent.Tools, ba.AgentToolWebSearch) {
	_, err = client.Agents.Update(ctx, agentID, ba.UpdateAgentParams{
		Tools: append(agent.Tools, ba.AgentToolWebSearch),
	})
	if err != nil {
		return err
	}
}
```
