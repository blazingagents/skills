# Get typed JSON from an Agent: Python code

The Python code for the steps of [Get typed JSON from an Agent](structured-output.md). Read that file first: it explains each step, its decisions, and its gotchas. Sections here match its steps and headings.

## Step 1: Define the shape, send it as JSON Schema, and validate the final object

```python
from typing import Literal

from blazing_agents import BlazingAgents
from pydantic import BaseModel


class Triage(BaseModel):
    category: Literal["billing", "technical", "other"]
    urgent: bool
    summary: str


client = BlazingAgents()  # reads BLAZING_AGENTS_API_KEY


def triage(agent_id: str, message: str) -> Triage:
    return client.object(
        agent_id=agent_id,
        prompt=f"Triage this support message:\n\n{message}",
        output_type=Triage,
    )
```

## Step 2: To show progress, relay the stream from your backend

```python
from typing import Literal

from blazing_agents import BlazingAgents
from pydantic import BaseModel


class Triage(BaseModel):
    category: Literal["billing", "technical", "other"]
    urgent: bool
    summary: str


client = BlazingAgents()


def triage_with_progress(agent_id: str, message: str) -> Triage:
    with client.object_stream(
        agent_id=agent_id,
        prompt=f"Triage this support message:\n\n{message}",
        output_type=Triage,
    ) as stream:
        for json_text in stream:
            print(json_text, end="", flush=True)  # or forward it to your client
        return stream.get_final_object()
```

## Step 3: To keep the wording out of your code, save a Prompt once and call it with `promptId` and `variables` instead of `prompt`

```python
from typing import Literal

from blazing_agents import BlazingAgents
from pydantic import BaseModel


class Triage(BaseModel):
    category: Literal["billing", "technical", "other"]
    urgent: bool
    summary: str


client = BlazingAgents()


def create_triage_prompt() -> str:
    prompt = client.prompts.create(
        name="Support triage",
        template="Triage this message from a {{ plan }} customer:\n\n{{ message }}",
    )
    return prompt.id


def triage_with_prompt(agent_id: str, prompt_id: str, plan: str, message: str) -> Triage:
    return client.object(
        agent_id=agent_id,
        prompt_id=prompt_id,
        variables={"plan": plan, "message": message},
        output_type=Triage,
    )
```
