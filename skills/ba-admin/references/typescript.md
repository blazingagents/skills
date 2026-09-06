# TypeScript execution

Use an existing compatible `@blazingagents/sdk` installation when available.
Otherwise create an isolated temporary Node project and install the current SDK
and its `ai@^7` peer dependency there. Do not add dependencies to the user's
application solely for an administrative call.

## Program shape

Create an ESM script in the temporary project. Replace the marked expression
with the single requested operation.

```js
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";

const apiKey = process.env.BLAZING_AGENTS_API_KEY;
if (!apiKey) throw new Error("BLAZING_AGENTS_API_KEY is required");

const baseUrl = process.env.BLAZING_AGENTS_BASE_URL;
const client = new BlazingAgents({ apiKey, ...(baseUrl ? { baseUrl } : {}) });

try {
  const result = await client.agents.list(); // replace this expression
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (!BlazingAgentsError.isInstance(error)) throw error;
  console.error(JSON.stringify({
    message: error.message,
    code: error.code,
    status: error.status,
    requestId: error.requestId,
    param: error.param,
  }));
  process.exitCode = 1;
}
```

Shell tracing must remain disabled. Never interpolate the API key into source,
arguments, URLs, logs, or generated files. Remove the temporary project after
the result has been captured.

## Operation map

Read the installed package's declarations for exact bodies and response types.
These are the supported administrative methods:

| Area | Read | Mutate |
| --- | --- | --- |
| Tenant | `client.tenant.get()` | `client.tenant.patch(body)` |
| Agents | `list`, `get` | `create`, `update`, `delete` |
| Providers | `client.providers.list()`, `get(id)`, `listModels(id)` | — |
| Workspaces | `list`, `get` | `create`, `update`, `delete` |
| Skills | `client.agent(agentId).skills.list/get/getFile` | `create`, `upload`, `putFile`, `deleteFile`, `copy`, `delete` |
| Prompts | `client.prompts.list/get` | `create`, `update`, `delete` |
| Tasks | `client.tasks.list/get/listRuns/getRun/runMessages` | `create`, `update`, `delete`, `createRun`, `cancelRun` |
| Usage | `client.usage.get()`, `getForAgent(agentId)` | — |
| Sessions | `client.sessions.list/messages` | `delete` |
| Artifacts | `client.artifacts.list()` | — |

Resource method names are invoked on the object shown in the first column's
read example. For example:

```js
await client.agents.update(agentId, changes);
await client.workspaces.update({ workspaceId, ...changes });
await client.agent(agentId).skills.putFile({ skillId, path, content });
await client.tasks.createRun(taskId, { idempotencyKey });
```

Follow cursors until the requested match is found or `nextCursor` is null.
Agent names are not unique selectors. Prompt, Provider, Workspace, Skill, and
Task name searches must also reject ambiguity even where the product enforces
uniqueness today.

## Mutation invariants

- Agent `providerId` and `model` are set or cleared together.
- `client.agents.delete(agentId, includeArtifacts)` requires an explicit
  Artifact choice. Preserve Artifacts when the user explicitly chooses
  preservation; never infer deletion.
- `client.sessions.delete(agentId, sessionId, deleteArtifacts)` has the same
  explicit Artifact-choice requirement.
- Workspace deletion may return `"pending"`; report it as accepted cleanup,
  not completed deletion.
- Skill uploads accept zip or tar archives through the SDK's current typed
  input. Use binary values, not credentials or shell interpolation.
- A Task-run idempotency key is caller-owned. Reuse it only for reconciliation
  of the same logical run request.
- The platform-managed Admin Agent cannot be updated or deleted.

For create and update bodies, import the relevant exported TypeScript type or
inspect the SDK declaration before writing the object. This prevents the Skill
from caching schemas that change with the public client.
