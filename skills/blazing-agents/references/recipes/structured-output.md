# Get typed JSON from an Agent

You will have a backend function that sends an Agent a prompt and gets back a validated object in a shape you define, plus an optional live preview in the browser while the object streams.

## When to use this

Your code needs a result it can act on, not prose: extraction, classification, routing, scoring, or filling a form. If you instead want a conversation the Agent remembers, read [Add chat to your app](chat-in-your-app.md). If you want the Agent to hand back a file such as a report or CSV, read [Deliver files from an Agent](files-and-deliverables.md).

## How it works

`client.object()` sends an Agent a prompt and a JSON Schema, and the model's answer is held to that schema while it generates. The call is stateless: it creates no Session, saves no transcript, and the Agent cannot publish Artifacts during it. Everything else about the Agent still applies, including its model, instructions, and tools. You get a stream of partial objects for display and one final object for your code. The prompt is either literal text or a saved Prompt with `variables`.

## Build it

1. Define the shape, send it as JSON Schema, and validate the final object. In TypeScript `result.object` resolves to `unknown`, so parse it with the same Zod schema.

```ts
import { BlazingAgents } from "@blazingagents/sdk";
import { z } from "zod";

const Triage = z.object({
  category: z.enum(["billing", "technical", "other"]),
  urgent: z.boolean(),
  summary: z.string(),
});

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
if (!apiKey) throw new Error("Set BLAZING_AGENTS_API_KEY");
const client = new BlazingAgents({ apiKey });

export async function triage(agentId: string, message: string) {
  const result = await client.object({
    agentId,
    prompt: `Triage this support message:\n\n${message}`,
    schema: z.toJSONSchema(Triage),
  });
  return Triage.parse(await result.object);
}
```

`z.toJSONSchema` ships with Zod 4. If you already use the AI SDK helpers, `await zodSchema(Triage).jsonSchema` from `ai` produces the same JSON Schema. A hand-written JSON Schema object works too.

In Python, pass a Pydantic model as `output_type`. The SDK sends its JSON Schema and returns a validated instance. Pass `json_schema={...}` instead to get plain JSON back.

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

2. To show progress, relay the stream from your backend. `toResponse()` returns the JSON text as it arrives, which is the format the AI SDK `useObject` hook reads.

```ts
import { BlazingAgents } from "@blazingagents/sdk";
import { z } from "zod";

const Triage = z.object({
  category: z.enum(["billing", "technical", "other"]),
  urgent: z.boolean(),
  summary: z.string(),
});
const Body = z.object({ message: z.string().min(1) });

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
if (!apiKey) throw new Error("Set BLAZING_AGENTS_API_KEY");
const client = new BlazingAgents({ apiKey });

declare const agentId: string;

export async function POST(request: Request): Promise<Response> {
  const { message } = Body.parse(await request.json());
  const result = await client.object({
    agentId,
    prompt: `Triage this support message:\n\n${message}`,
    schema: z.toJSONSchema(Triage),
  });
  return result.toResponse();
}
```

```tsx
import { useObject } from "@ai-sdk/react";
import { z } from "zod";

const Triage = z.object({
  category: z.enum(["billing", "technical", "other"]),
  urgent: z.boolean(),
  summary: z.string(),
});

export function TriagePanel({ message }: { message: string }) {
  const { object, submit, isLoading, error } = useObject({
    api: "/api/triage",
    schema: Triage,
  });
  return (
    <div>
      <button type="button" disabled={isLoading} onClick={() => submit({ message })}>
        Triage
      </button>
      {error ? <p>Triage failed. Try again.</p> : null}
      <p>
        {object?.category} {object?.urgent ? "(urgent)" : null}
      </p>
      <p>{object?.summary}</p>
    </div>
  );
}
```

On the backend alone, iterate `result.partialObjectStream` for partial objects and then `await result.object` for the final one. In Python, `object_stream` yields raw JSON text, not parsed partials:

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

3. To keep the wording out of your code, save a Prompt once and call it with `promptId` and `variables` instead of `prompt`.

```ts
import { BlazingAgents } from "@blazingagents/sdk";
import { z } from "zod";

const Triage = z.object({
  category: z.enum(["billing", "technical", "other"]),
  urgent: z.boolean(),
  summary: z.string(),
});

declare const client: BlazingAgents;

/** Run once at setup, then store the returned prompt_... ID in your config. */
export async function createTriagePrompt() {
  const prompt = await client.prompts.create({
    name: "Support triage",
    template: "Triage this message from a {{ plan }} customer:\n\n{{ message }}",
  });
  return prompt.id;
}

export async function triageWithPrompt(
  agentId: string,
  promptId: string,
  plan: string,
  message: string
) {
  const result = await client.object({
    agentId,
    promptId,
    variables: { plan, message },
    schema: z.toJSONSchema(Triage),
  });
  return Triage.parse(await result.object);
}
```

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

## Gotchas

- Using `result.object` directly in TypeScript. It is `unknown`. Parse it with your Zod schema before use.
- Treating a partial object as the answer. Partials can miss required fields or stop mid-string. Show them, then act only on the final object.
- A schema rejected with `validation_failed` before anything runs. The schema needs a root `type` or `properties`. List `required` fields, use `enum` for fixed choices, and set `additionalProperties: false` on hand-written schemas.
- Expecting the Agent to remember the last call. There is no Session. Put all needed context in the prompt, or use chat.
- Asking the Agent to publish a file here. Stateless calls cannot publish Artifacts. Use a chat Session or a Task run for files.
- Not handling bad final JSON. TypeScript rejects `result.object` with a `BlazingAgentsError` whose `code` is `stream_error`. Python raises `StreamError` (subclasses `ObjectJSONDecodeError`, `ObjectTruncationError`, `ObjectValidationError`). Retry or show an error.
- Passing the wrong Prompt variables. Every variable is required and extras are rejected (`prompt_variable_missing`, `prompt_variable_unknown`).
- Calling `client.object()` from the browser. Your Tenant key must stay on the backend. The browser calls your endpoint, as `useObject` does above.
- Calling `toResponse()` twice. The body can be claimed once per result.

## Check it works

- Call `triage` with "I was charged twice and need a refund today." You get `category: "billing"` and `urgent: true` as a typed object.
- Send `schema: {}`. The call fails with `validation_failed` and no tokens stream.
- Open the triage panel and click the button. The summary fills in word by word before the button re-enables.
- Call `triageWithPrompt` without `plan` in `variables`. It fails with `prompt_variable_missing`.

## Go deeper

- [Structured output](https://docs.blazingagents.com/agents/output/structured-output)
- [Prompts](https://docs.blazingagents.com/agents/prompts)
- `object()` in the [TypeScript client](https://docs.blazingagents.com/sdk/typescript/client#object) and [Python client](https://docs.blazingagents.com/sdk/python/client#object)
- [Generation REST API](https://docs.blazingagents.com/api-reference/rest-api/generation)
- [Error codes](https://docs.blazingagents.com/api-reference/protocols/errors)
