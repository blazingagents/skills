# Troubleshoot a Blazing Agents integration: Python code

The Python code for the steps of [Troubleshoot a Blazing Agents integration](troubleshooting.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Read the error first

```python
from blazing_agents import Agent, APIStatusError, BlazingAgents


def read_agent(client: BlazingAgents, agent_id: str) -> Agent:
    try:
        return client.agents.get(agent_id)
    except APIStatusError as error:
        print(
            {
                "code": error.code,
                "status": error.status_code,
                "request_id": error.request_id,
                "agent_id": agent_id,
            }
        )
        raise
```

## MCP authorization missing

```python
from blazing_agents import BlazingAgents


def check_mcp_connection(client: BlazingAgents, mcp_connection_id: str) -> None:
    connection = client.mcp_connections.get(mcp_connection_id)
    print(connection.status, connection.last_auth_error_code)
    test = client.mcp_connections.test(mcp_connection_id)
    if test.error is not None:
        print(test.error.code, test.error.message)
```

## Chat Connection health unknown

```python
from blazing_agents import BlazingAgents


def check_chat_health(client: BlazingAgents, chat_connection_id: str) -> None:
    connection = client.chat_connections.check_health(chat_connection_id)
    print(connection.enabled, connection.health.token_valid)
    for check in connection.health.checks:
        if check.status != "pass":
            print(check.code, check.status, check.subject)
```
