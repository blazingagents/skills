# Put your Agent in Slack or Telegram: Python code

The Python code for the steps of [Put your Agent in Slack or Telegram](slack-and-telegram.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Create the connection with intake disabled, so no message arrives before setup is done

```python
import os

from blazing_agents import BlazingAgents

client = BlazingAgents()

connection = client.chat_connections.create(
    name="Support on Slack",
    agent_id="ag_0123456789abcdef",
    platform="slack",
    enabled=False,
    credentials={
        "bot_token": os.environ["SLACK_BOT_TOKEN"],
        "signing_secret": os.environ["SLACK_SIGNING_SECRET"],
    },
    configuration={"channel_ids": ["C0123456789"]},
)
print(connection.id, connection.webhook_url)
```

## Step 3: Check health, enable, then check again

```python
from blazing_agents import BlazingAgents


def go_live(client: BlazingAgents, chat_connection_id: str) -> None:
    before = client.chat_connections.check_health(chat_connection_id)
    if not (before.health.token_valid and before.health.identity_verified):
        raise RuntimeError("Bot credentials rejected; fix them before enabling")

    client.chat_connections.enable(chat_connection_id)

    health = client.chat_connections.check_health(chat_connection_id).health
    webhook = next((c for c in health.checks if c.code == "webhook_url"), None)
    if webhook is None or webhook.status != "pass":
        print("Webhook not confirmed", health.checks)
```

## Step 4: Rotate credentials by sending the complete set for the same bot or Slack installation

```python
from blazing_agents import BlazingAgents


def rotate(client: BlazingAgents, chat_connection_id: str, new_bot_token: str) -> None:
    rotated = client.chat_connections.rotate_credentials(
        chat_connection_id,
        platform="telegram",
        credentials={"bot_token": new_bot_token},
    )
    print(rotated.credential_version, rotated.credential_fragment)
```

## Step 5: Pause or remove the connection

```python
from blazing_agents import BlazingAgents


def remove(client: BlazingAgents, chat_connection_id: str) -> None:
    client.chat_connections.disable(chat_connection_id)
    client.chat_connections.delete(chat_connection_id)
```
