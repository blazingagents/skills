# Serve many end users from one account: Go code

The Go code for the steps of [Serve many end users from one account](multi-user-apps.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Derive a scoped client from the session your backend verified

```go
verifiedUserID := "user_123"
scoped, err := client.ForUser("app:" + verifiedUserID)
if err != nil {
	return err
}
page, err := scoped.Agents.List(ctx, ba.ListAgentsParams{Limit: new(50)})
if err != nil {
	return err
}
fmt.Println(len(page.Data))
```
