# Let an Agent work with files and deliver them to your users: Go code

The Go code for the steps of [Let an Agent work with files and deliver them to your users](files-and-deliverables.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Create an Agent with the file tools the job needs, for the user who will chat with it

```go
agent, err := client.Agents.Create(ctx, ba.CreateAgentParams{
	Name:       "Report writer",
	ProviderID: ba.Value(ba.ProviderID("prv_0123456789abcdef")),
	Model:      ba.Value("openai/gpt-6-luna"),
	UserID:     new("app:user-42"), // the user this Agent serves
	Instructions: new("Write reports as Markdown files. " +
		"When a file is finished, publish it with publish_artifacts."),
	WorkspaceTier: new(ba.WorkspaceTierPlus),
	Tools:         []ba.AgentTool{ba.AgentToolRead, ba.AgentToolWrite, ba.AgentToolBash, ba.AgentToolPublishArtifacts},
})
if err != nil {
	return err
}
fmt.Println(agent.ID, agent.WorkspaceID)
```

## Step 2: To let several of a user's Agents work on the same files, create a Workspace with the same `userId` and attach each Agent to it

```go
agentIDs := []ba.AgentID{"ag_0123456789abcdef", "ag_abcdef0123456789"}
workspace, err := client.Workspaces.Create(ctx, ba.CreateWorkspaceParams{
	Name:          new("Release files"),
	UserID:        new("app:user-42"), // the user who owns both Agents
	Tier:          new(ba.WorkspaceTierPlus),
	NetworkPolicy: ba.NetworkPolicyAllowlist{AllowedHosts: []string{"registry.npmjs.org"}},
})
if err != nil {
	return err
}
for _, id := range agentIDs {
	_, err := client.Agents.Update(ctx, id, ba.UpdateAgentParams{WorkspaceID: new(workspace.ID)})
	if err != nil {
		return err
	}
}
fmt.Println(workspace.ID)
```

## Step 3: Ask for the file in a chat turn on the signed-in user's End-user scoped client, read the stream to the end, then list the Session's Artifacts through the same client

```go
scoped, err := client.ForUser("app:user-42") // the verified signed-in user
if err != nil {
	return err
}
stream, err := scoped.Chat.Send(ctx, agentID,
	ba.Messages(ba.TextMessage("Write a short release summary to release.md, then publish it.")),
	ba.ChatParams{})
if err != nil {
	return err
}
defer stream.Close()
chatSessionID := stream.SessionID()
for _, err := range stream.Events() {
	if err != nil {
		return err
	}
	// or forward each event to your client
}
page, err := scoped.Artifacts.List(ctx, ba.ListArtifactsParams{AgentID: new(agentID), SessionID: new(chatSessionID)})
if err != nil {
	return err
}
for _, artifact := range page.Data {
	fmt.Println(artifact.ID, artifact.Filename, artifact.SizeBytes)
}
```

## Step 4: Serve downloads from your backend through the signed-in user's scoped client, then redirect to a fresh download URL

```go
scoped, err := client.ForUser("app:user-42") // the verified signed-in user
if err != nil {
	return err
}
download, err := scoped.Artifacts.CreateDownloadURL(ctx, ba.ArtifactID("at_0123456789abcdef"))
if err != nil {
	return err // another user's Artifact is a 404 *ba.APIError: respond 404
}
// Redirect to download.URL.Reveal(). The Secret prints as [redacted] in logs.
_ = download.URL.Reveal()
```

## Step 5: Clean up through the same scoped client

```go
scoped, err := client.ForUser("app:user-42") // the verified signed-in user
if err != nil {
	return err
}
if err := scoped.Artifacts.Delete(ctx, ba.ArtifactID("at_0123456789abcdef")); err != nil {
	return err
}
if err := scoped.Sessions.Delete(ctx, agentID, sessionID, ba.DeleteSessionParams{DeleteArtifacts: true}); err != nil {
	return err
}
if err := scoped.Workspaces.Delete(ctx, ba.WorkspaceID("ws_0123456789abcdef")); err != nil {
	return err
}
```
