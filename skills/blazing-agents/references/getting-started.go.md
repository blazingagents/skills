# Get started with Blazing Agents: Go code

The Go code for the steps of [Get started with Blazing Agents](getting-started.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Install the SDK

```bash
go get github.com/blazingagents/golang-sdk@latest
```

## Step 2: Check the connection

```go
page, err := client.Agents.List(ctx, ba.ListAgentsParams{})
if err != nil {
	return err
}
fmt.Printf("Connected. First page has %d agents.\n", len(page.Data))
```

## Step 3: Create the Provider and Agent, then stream a first reply

```go
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	ba "github.com/blazingagents/golang-sdk"
)

func main() {
	ctx := context.Background()
	client, err := ba.NewClient() // reads BLAZING_AGENTS_API_KEY
	if err != nil {
		log.Fatal(err)
	}

	providerName := "Quickstart OpenRouter"
	providers, err := client.Providers.List(ctx)
	if err != nil {
		log.Fatal(err)
	}
	var providerID ba.ProviderID
	for _, provider := range providers {
		if provider.Name == providerName {
			providerID = provider.ID
		}
	}
	if providerID == "" {
		provider, err := client.Providers.Create(ctx, ba.CreateProviderParams{
			Name:         providerName,
			ProviderType: ba.ProviderTypeOpenRouter,
			APIKey:       ba.NewSecret(os.Getenv("OPENROUTER_API_KEY")),
		})
		if err != nil {
			log.Fatal(err)
		}
		providerID = provider.ID
	}

	agentName := "Quickstart agent"
	var matches []ba.Agent
	for agent, err := range client.Agents.All(ctx, ba.ListAgentsParams{Limit: new(100)}) {
		if err != nil {
			log.Fatal(err)
		}
		if agent.Name == agentName {
			matches = append(matches, agent)
		}
	}
	if len(matches) > 1 {
		log.Fatal("Multiple Agents match. Choose an ID.")
	}
	var agent *ba.Agent
	if len(matches) == 1 {
		agent = &matches[0]
	} else {
		agent, err = client.Agents.Create(ctx, ba.CreateAgentParams{
			Name:       agentName,
			ProviderID: ba.Value(providerID),
			Model:      ba.Value("openai/gpt-6-luna"),
		})
		if err != nil {
			log.Fatal(err)
		}
	}

	stream, err := client.Chat.Send(ctx, agent.ID,
		ba.Messages(ba.TextMessage("Say hello in one short sentence.")), ba.ChatParams{})
	if err != nil {
		log.Fatal(err)
	}
	defer stream.Close()
	fmt.Println("Session:", stream.SessionID())
	for event, err := range stream.Events() {
		if err != nil {
			log.Fatal(err)
		}
		os.Stdout.Write(event)
	}
	// Raw AI SDK UI message stream: relay it, store it, or render it as you like.
}
```
