# Put your Agent in Slack or Telegram: Go code

The Go code for the steps of [Put your Agent in Slack or Telegram](slack-and-telegram.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Create the connection with intake disabled, so no message arrives before setup is done

```go
connection, err := client.ChatConnections.Create(ctx, ba.SlackConnection{
	AgentID:    agentID,
	Name:       "Support on Slack",
	Enabled:    new(false),
	ChannelIDs: []string{"C0123456789"},
	Credentials: ba.SlackCredentials{
		BotToken:      ba.NewSecret(os.Getenv("SLACK_BOT_TOKEN")),
		SigningSecret: ba.NewSecret(os.Getenv("SLACK_SIGNING_SECRET")),
	},
})
if err != nil {
	return err
}
fmt.Println(connection.ID, connection.WebhookURL)
```

## Step 3: Check health, enable, then check again

```go
connectionID := ba.ChatConnectionID("cc_0123456789abcdef")
before, err := client.ChatConnections.CheckHealth(ctx, connectionID)
if err != nil {
	return err
}
if !before.Health.TokenValid || !before.Health.IdentityVerified {
	return errors.New("bot credentials rejected; fix them before enabling")
}

if _, err := client.ChatConnections.Enable(ctx, connectionID); err != nil {
	return err
}

after, err := client.ChatConnections.CheckHealth(ctx, connectionID)
if err != nil {
	return err
}
webhookConfirmed := false
for _, check := range after.Health.Checks {
	if check.Code == "webhook_url" && check.Status == ba.ChatHealthCheckStatusPass {
		webhookConfirmed = true
	}
}
if !webhookConfirmed {
	fmt.Println("Webhook not confirmed", after.Health.Checks)
}
```

## Step 4: Rotate credentials by sending the complete set for the same bot or Slack installation

```go
newBotToken := "123456:telegram-token"
rotated, err := client.ChatConnections.RotateCredentials(ctx, ba.ChatConnectionID("cc_0123456789abcdef"),
	ba.TelegramCredentials{BotToken: ba.NewSecret(newBotToken)})
if err != nil {
	return err
}
fmt.Println(rotated.CredentialVersion, rotated.CredentialFragment)
```

## Step 5: Pause or remove the connection

```go
connectionID := ba.ChatConnectionID("cc_0123456789abcdef")
if _, err := client.ChatConnections.Disable(ctx, connectionID); err != nil {
	return err
}
if err := client.ChatConnections.Delete(ctx, connectionID); err != nil {
	return err
}
```
