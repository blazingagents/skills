# Get typed JSON from an Agent: Go code

The Go code for the steps of [Get typed JSON from an Agent](structured-output.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Define the shape, send it as JSON Schema, and validate the final object

```go
type Triage struct {
	Category string `json:"category" jsonschema:"billing, technical, or other"`
	Urgent   bool   `json:"urgent"`
	Summary  string `json:"summary"`
}

triage, err := ba.Object(ctx, client.Generation, agentID,
	ba.Text("Triage this support message:\n\nWhere is my invoice?"), ba.ObjectParams[Triage]{})
if err != nil {
	return err
}
fmt.Println(triage.Category, triage.Summary)
```

## Step 2: To show progress, relay the stream from your backend

```go
type Triage struct {
	Category string `json:"category"`
	Urgent   bool   `json:"urgent"`
	Summary  string `json:"summary"`
}

stream, err := ba.StreamObject(ctx, client.Generation, agentID,
	ba.Text("Triage this support message:\n\nWhere is my invoice?"), ba.ObjectParams[Triage]{})
if err != nil {
	return err
}
defer stream.Close()
for delta, err := range stream.Deltas() {
	if err != nil {
		return err
	}
	fmt.Print(delta) // or forward it to your client
}
triage, err := stream.Object()
if err != nil {
	return err
}
fmt.Printf("\n%s %s\n", triage.Category, triage.Summary)
```

## Step 3: To keep the wording out of your code, save a Prompt once and call it with `promptId` and `variables` instead of `prompt`

```go
type Triage struct {
	Category string `json:"category"`
	Urgent   bool   `json:"urgent"`
	Summary  string `json:"summary"`
}

prompt, err := client.Prompts.Create(ctx, ba.CreatePromptParams{
	Name:     "Support triage",
	Template: "Triage this message from a {{ plan }} customer:\n\n{{ message }}",
})
if err != nil {
	return err
}
triage, err := ba.Object(ctx, client.Generation, agentID, ba.SavedPrompt{
	ID:        prompt.ID,
	Variables: map[string]string{"plan": "pro", "message": "Where is my invoice?"},
}, ba.ObjectParams[Triage]{})
if err != nil {
	return err
}
fmt.Println(triage.Category, triage.Summary)
```
