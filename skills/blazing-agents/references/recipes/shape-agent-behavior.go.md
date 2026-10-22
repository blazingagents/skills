# Tune what your Agent does: Go code

The Go code for the steps of [Tune what your Agent does](shape-agent-behavior.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Set the model, instructions, and context compaction in one update

```go
providerID := ba.ProviderID("prv_0123456789abcdef")
models, err := client.Providers.ListModels(ctx, providerID)
if err != nil {
	return err
}
if !slices.ContainsFunc(models, func(m ba.ProviderModel) bool { return m.ID == "openai/gpt-6-luna" }) {
	return errors.New("model not offered by this Provider")
}

agent, err := client.Agents.Update(ctx, agentID, ba.UpdateAgentParams{
	ProviderID:              ba.Value(providerID),
	Model:                   ba.Value("openai/gpt-6-luna"),
	Instructions:            new("You are the support assistant for Acme. Answer in two short paragraphs."),
	Tools:                   []ba.AgentTool{ba.AgentToolRead, ba.AgentToolGrep, ba.AgentToolGlob, ba.AgentToolSaveMemory, ba.AgentToolSearchMemories},
	CompactionReserveTokens: new(32_768),
})
if err != nil {
	return err
}
fmt.Println(*agent.Model, agent.Instructions)
```

## Step 2: Save a Prompt linked to the Agent and run it with exactly its variables

```go
prompt, err := client.Prompts.Create(ctx, ba.CreatePromptParams{
	Name:     "Release summary",
	Template: "Summarize {{ version }} for {{ audience }}.",
	AgentID:  ba.Value(agentID),
})
if err != nil {
	return err
}
answer, err := client.Generation.Completion(ctx, agentID, ba.SavedPrompt{
	ID:        prompt.ID,
	Variables: map[string]string{"version": "2.4", "audience": "developers"},
}, ba.GenerateParams{})
if err != nil {
	return err
}
fmt.Println(answer)
page, err := client.Prompts.List(ctx, ba.ListPromptsParams{AgentID: new(agentID)})
if err != nil {
	return err
}
for _, p := range page.Data {
	fmt.Println(p.Name)
}
```

## Step 3: Upload a runtime Skill

```go
skill, err := client.Skills.Upload(ctx, agentID, ba.UploadSkillParams{
	Type: ba.ArchiveTypeZip,
	File: ba.UploadFile("release-notes.zip"),
})
if err != nil {
	return err
}
fmt.Println(skill.Name)
for _, file := range skill.Files {
	fmt.Println(file.Path)
}

_, err = client.Skills.ReplaceFile(ctx, agentID, skill.ID, "references/style-guide.md",
	strings.NewReader("Use sentence case headings.\n"))
if err != nil {
	return err
}
```

## Step 4: Store Memory for one End-user and turn on injection so every Turn of theirs starts with the newest notes it can see, general and that user's (up to 4,000 words)

```go
if _, err := client.Agents.Update(ctx, agentID, ba.UpdateAgentParams{MemoryInjectionEnabled: new(true)}); err != nil {
	return err
}

scoped, err := client.ForUser("app:user-42") // the verified user who owns this Agent
if err != nil {
	return err
}
memory, err := scoped.Memories.Create(ctx, agentID, ba.CreateMemoryParams{
	Text: "Prefers concise status updates.",
})
if err != nil {
	return err
}

page, err := scoped.Memories.List(ctx, agentID, ba.ListMemoriesParams{Search: new("status")})
if err != nil {
	return err
}
for _, m := range page.Data {
	fmt.Println(m.Text)
}

if _, err := scoped.Memories.Update(ctx, agentID, memory.ID, ba.UpdateMemoryParams{Text: "Prefers bullet-point status updates."}); err != nil {
	return err
}
if err := scoped.Memories.Delete(ctx, agentID, memory.ID); err != nil {
	return err
}
```

## Step 5: Read saved configuration and pause new work from trusted backend code with the unscoped client

```go
session, err := client.Sessions.Get(ctx, agentID, sessionID)
if err != nil {
	return err
}
if session.AgentConfig.Model != nil {
	fmt.Println(*session.AgentConfig.Model)
}
fmt.Println(session.AgentConfig.Instructions)

if _, err := client.Agents.Disable(ctx, agentID); err != nil {
	return err
}
if _, err := client.Agents.Enable(ctx, agentID); err != nil {
	return err
}
```
