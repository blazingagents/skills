# Put your Agent in Slack or Telegram: Rust code

The Rust code for the steps of [Put your Agent in Slack or Telegram](slack-and-telegram.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Create the connection with intake disabled, so no message arrives before setup is done

```rust
use blazing_agents::chat_connections::{NewSlackConnection, SlackCredentials};

let connection = client
    .chat_connections()
    .create(
        NewSlackConnection::new(
            "ag_0123456789abcdef",
            "Support on Slack",
            SlackCredentials::new(
                std::env::var("SLACK_BOT_TOKEN")?,
                std::env::var("SLACK_SIGNING_SECRET")?,
            ),
        )
        .enabled(false)
        .channel_ids(["C0123456789"]),
    )
    .await?;
println!("{} {}", connection.id, connection.webhook_url);
```

## Step 3: Check health, enable, then check again

```rust
use blazing_agents::chat_connections::ChatHealthCheckStatus;

let chat_connection_id = "cc_0123456789abcdef";
let before = client
    .chat_connections()
    .check_health(chat_connection_id)
    .await?;
if !(before.health.token_valid && before.health.identity_verified) {
    return Err("Bot credentials rejected; fix them before enabling".into());
}

client.chat_connections().enable(chat_connection_id).await?;

let health = client
    .chat_connections()
    .check_health(chat_connection_id)
    .await?
    .health;
let webhook = health.checks.iter().find(|check| check.code == "webhook_url");
if webhook.is_none_or(|check| check.status != ChatHealthCheckStatus::Pass) {
    println!("Webhook not confirmed {:?}", health.checks);
}
```

## Step 4: Rotate credentials by sending the complete set for the same bot or Slack installation

```rust
use blazing_agents::chat_connections::ChatCredentials;

let new_bot_token = "123456:telegram-token";
let rotated = client
    .chat_connections()
    .rotate_credentials("cc_0123456789abcdef", ChatCredentials::telegram(new_bot_token))
    .await?;
println!("{} {}", rotated.credential_version, rotated.credential_fragment);
```

## Step 5: Pause or remove the connection

```rust
let chat_connection_id = "cc_0123456789abcdef";
client
    .chat_connections()
    .disable(chat_connection_id)
    .await?;
client
    .chat_connections()
    .delete(chat_connection_id)
    .await?;
```
