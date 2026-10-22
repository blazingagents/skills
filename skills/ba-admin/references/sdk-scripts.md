# SDK scripts

Use a script only for an operation the BA MCP server's tools lack, or when the
user cannot connect the server. Read the installed `@blazingagents/sdk`
declarations for exact bodies and responses; they are the source of truth.

## Set up

Use the project's `@blazingagents/sdk` when it is installed. Otherwise create a
temporary Node project and run `npm install @blazingagents/sdk ai zod` there.
Never add dependencies to the user's app only for an administrative call.
Remove the temporary project once you have the result.

## Program shape

Save the script as `admin.mts` and run it with `node admin.mts`. Replace the
marked expression with the one requested operation.

```ts
import { BlazingAgents, BlazingAgentsError } from "@blazingagents/sdk";

const apiKey = process.env.BA_API_KEY;
if (!apiKey) throw new Error("Set BA_API_KEY to a Blazing Agents API key");
const baseUrl = process.env.BLAZING_AGENTS_BASE_URL;
const client = new BlazingAgents({ apiKey, ...(baseUrl ? { baseUrl } : {}) });

try {
  const result = await client.tenant.getSpendingLimit(); // replace this expression
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (!BlazingAgentsError.isInstance(error)) throw error;
  console.error(JSON.stringify({
    message: error.message,
    code: error.code,
    status: error.status,
    requestId: error.requestId,
  }));
  process.exitCode = 1;
}
```

Keep shell tracing off. Never write the key into source, arguments, URLs, logs,
or files.

## Operations the MCP tools lack

| Area | Read | Change (full key) |
| --- | --- | --- |
| Model spending limits | `client.tenant.getSpendingLimit()`, `client.agents.getSpendingLimit({ agentId })` | `client.tenant.updateSpendingLimit({ spendingLimit })`, `client.agents.updateSpendingLimit({ agentId, spendingLimit })` |
| Agent kill switch | `client.agents.get({ agentId })` (`status` is `active` or `disabled`) | `client.agents.disable({ agentId })`, `client.agents.enable({ agentId })` |
| Chat Connections | `client.chatConnections.list()`, `get({ chatConnectionId })`, `checkHealth({ chatConnectionId })` | `create`, `update`, `rotateCredentials`, `enable`, `disable`, `delete` |
| Sessions | `client.sessions.get({ agentId, sessionId })`, `inputs({ agentId, sessionId })`, `listLatest()` | `client.sessions.fork({ agentId, sessionId, messageId, idempotencyKey })` |
| Providers | `client.providers.getThinkingLevels({ providerId, model })` | none: Providers are created in the dashboard or the app's code |
| Usage | `client.usage.overview()`, `client.usage.getForAgent({ agentId })` | none |

To read every page of a list before matching a name:

```ts
import { BlazingAgents } from "@blazingagents/sdk";

declare const client: BlazingAgents;
declare const requestedName: string;

const matches = [];
let cursor: string | undefined;
do {
  const page = await client.agents.list({ cursor, limit: 100 });
  matches.push(...page.data.filter((agent) => agent.name === requestedName));
  cursor = page.nextCursor ?? undefined;
} while (cursor !== undefined);
if (matches.length !== 1) {
  throw new Error(`Expected one Agent named ${requestedName}; found ${matches.length}`);
}
const agentId = matches[0].id;
```

## Rules for these operations

- A disabled Agent refuses every new Turn with `agent_disabled`, while Turns
  already running finish. Its schedules stay, and their fires are skipped.
  Use it as the kill switch in an incident. The Admin Agent cannot be disabled
  (`admin_agent_managed`).
- Fork a Session only when the user asks. Resolve the source Session and the
  assistant message the user chose, and require `branchable: true` on it in
  `sessions.messages()`. Choose the idempotency key before sending, and retry
  with the same values after an uncertain response. Verify the child with
  `sessions.get()` and `sessions.messages()`, then report its ID. A fork runs no
  model or Tool, and the child shares the Agent's Workspace files and Memories.
  `idempotency_conflict` means the key was reused with another message,
  `session_fork_unavailable` means the message is not branchable, and
  `session_fork_deleted` means the child for that key was deleted.
- A spending limit is `amountUsd`, `resetStartDate` (a UTC date), and
  `resetInterval` (`daily`, `weekly`, `biweekly`, or `monthly`). Resets happen
  at midnight UTC. Read the limit before and after saving. Saving takes effect
  at once and never clears money already spent in the period. Set
  `spendingLimit: null` only when the user asks to turn that limit off; Agent
  and Tenant limits are independent.
- After saving a spending limit, report `amountUsd`, `nextResetAt`, `spentUsd`,
  and `availableUsd`. Tell the user the limit estimates model-token cost only,
  excludes BA charges, and a running Turn can finish one model request past it.
- On `model_spending_limit_exceeded`, report its scope, reason, and next reset.
  Never retry, raise the limit, or turn it off unless the user asks.
