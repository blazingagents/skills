# Limits that shape a design

These are the BA limits that change how an app should be built. State them to
the user when they size a design, and design around them. The
[service limits page](https://docs.blazingagents.com/api-reference/protocols/service-limits)
owns every number and lists the rest. Each row links its source there, or the
docs page that states it. When a design sits right at a limit, confirm the
current value on that page.

## Capacity

| Limit | Value | What it means for a design |
| --- | --- | --- |
| Interactive Turns running at once, per Tenant ([row][concurrent-turns]) | 25 on Developer, 50 on Pro | Chat, approval continuations, and stateless `completion()` / `object()` calls share this pool. Over it, the call fails at once with `429 rate_limited` and no `Retry-After`; nothing queues. 200 users connected is not 200 Turns, but bursts need backoff in your backend. |
| Task runs running at once, per Tenant ([row][concurrent-task-runs]) | 50 on Developer, 100 on Pro | A separate pool. Extra runs wait as `queued` instead of failing, so move background work out of chat. |
| Agent, Task, and Workspace creation ([row][creation]) | 60 per minute and 1,000 per day, each kind | `429 rate_limited` with `Retry-After`. Create per-user Agents lazily on first use; bulk provisioning 10,000 users takes 10 days. |
| Agents per Tenant | No plan cap | Per-user Agents are allowed. An idle Agent runs no compute. |
| API keys per Tenant ([row][keys]) | 5 | Created only in the dashboard. |
| Turns per Session | 1 at a time | A second chat call while a Turn runs fails with `session_busy`; steer or queue in the client. |
| Your Provider's rate limits | Set by your model account | BA runs every Turn on your Provider key, so its rate and token limits apply on top of BA's. |

## One Turn

| Limit | Value | What it means for a design |
| --- | --- | --- |
| Turn deadline ([row][deadline]) | 30 minutes, fixed | The Turn stops; no setting changes it. Split longer work into several Task runs. |
| Model steps per Turn ([row][steps]) | 64 | A step is one model call; long tool loops end here. |
| Shell command in the Workspace ([row][shell-command]) | 30 seconds, then killed | Split `npm install`, builds, and test suites into commands that each finish within 30 seconds, or prepare them before the Agent needs them. |
| Backend function call ([row][backend-function-call]) | 60 seconds | The handler must answer in time; hand slow work to a Task. |
| MCP tool call ([row][mcp-timeouts]) | 60 seconds | Make slow MCP tools start work and return quickly. |
| Task run lifetime ([row][task-life]) | 35 minutes | The 30-minute Turn deadline fires first. |
| Active runs per Task ([row][active-run]) | 1 | A schedule fire that lands while a run is active is skipped, not queued. |
| Schedule interval ([row][interval]) | At least 1 minute | Fires can start up to about 30 seconds late ([row][scheduled-run-start]). Missed fires are not caught up. |

## Agent configuration and knowledge

| Limit | Value | What it means for a design |
| --- | --- | --- |
| Agent instructions ([row][agent-fields]) | 3,000 characters | Long procedures and reference material go in Skills. |
| Skills per Agent ([row][skills]) | 100 | Each per-user Agent needs its own copies. |
| One Skill ([row][skill-bundle]) | 100 files, 10 MiB | Split large reference sets across Skills. |
| Skill copy ([row][skill-copy]) | 1 to 30 destination Agents per request | Each copy is independent; later edits to one do not reach the others. Copying to many per-user Agents takes many requests. |
| Memories per Agent ([row][memories]) | 500, shared by all End-users of the Agent | The least recently used note is evicted silently. On a shared Agent, busy users push out other users' notes. A `forUser` save evicts only that user's notes and fails with `invalid_request` (400) when other users' or general notes fill the pool. |
| One Memory ([row][memory-text]) | 10 KiB | Memory is for short facts, not documents. |
| Memory injection ([row][memory-injection]) | Newest notes first, up to 4,000 words per Turn | Older notes reach the Agent only through the memory tools. |
| MCP Connections per Agent ([row][mcp-per-agent]) | 10 | |
| MCP Connections per Tenant ([row][mcp-per-tenant]) | 50 | |
| MCP tools ([row][mcp-tools]) | 128 per connection, 256 per Turn | Too many tools fail the Turn; attach only what an Agent needs. |
| MCP tool result ([row][mcp-payloads]) | 1 MiB | Return references, not large payloads. |

## Files and output

| Limit | Value | What it means for a design |
| --- | --- | --- |
| Artifact file ([row][artifact-file]) | 10 MiB | Larger deliverables need splitting. |
| Artifacts per publish call ([row][artifact-batch]) | 10 | |
| Artifacts per Session ([row][artifacts-session]) | 50 | A long-lived Session that publishes often reaches it; start a new Session. |
| Artifact download URL ([row][artifact-download-url]) | Expires after 5 minutes | Create one per download; never store it. |
| Workspace idle stop ([row][workspace-idle-stop]) | About 10 minutes without an operation | Core files are lost at the stop. |
| Plus Workspace files ([workspaces][ws]) | Discarded after 29 days unused | Keep anything important in an Artifact or in git. |
| Core Workspace disk ([row][workspace-disk]) | About 1.3 GB free, 256 MiB memory | Large toolchains need Plus. |
| Session messages page ([row][messages]) | 50 by default, 200 at most | Page through long histories. |

[creation]: https://docs.blazingagents.com/api-reference/protocols/service-limits#tenant-resource-creation-rate
[keys]: https://docs.blazingagents.com/api-reference/protocols/service-limits#api-keys-per-tenant
[deadline]: https://docs.blazingagents.com/api-reference/protocols/service-limits#turn-deadline
[steps]: https://docs.blazingagents.com/api-reference/protocols/service-limits#agent-loop-steps
[mcp-timeouts]: https://docs.blazingagents.com/api-reference/protocols/service-limits#mcp-runtime-timeouts
[task-life]: https://docs.blazingagents.com/api-reference/protocols/service-limits#task-run-lifetime
[active-run]: https://docs.blazingagents.com/api-reference/protocols/service-limits#active-task-run
[interval]: https://docs.blazingagents.com/api-reference/protocols/service-limits#task-interval
[agent-fields]: https://docs.blazingagents.com/api-reference/protocols/service-limits#agent-fields
[skills]: https://docs.blazingagents.com/api-reference/protocols/service-limits#skills-per-agent
[skill-bundle]: https://docs.blazingagents.com/api-reference/protocols/service-limits#skill-bundle
[skill-copy]: https://docs.blazingagents.com/api-reference/protocols/service-limits#skill-copy
[memories]: https://docs.blazingagents.com/api-reference/protocols/service-limits#memories-per-agent
[memory-text]: https://docs.blazingagents.com/api-reference/protocols/service-limits#memory-text
[mcp-per-agent]: https://docs.blazingagents.com/api-reference/protocols/service-limits#mcp-connections-per-agent
[mcp-per-tenant]: https://docs.blazingagents.com/api-reference/protocols/service-limits#mcp-connections-per-tenant
[mcp-tools]: https://docs.blazingagents.com/api-reference/protocols/service-limits#mcp-tools
[mcp-payloads]: https://docs.blazingagents.com/api-reference/protocols/service-limits#mcp-payloads
[artifact-file]: https://docs.blazingagents.com/api-reference/protocols/service-limits#artifact-file
[artifact-batch]: https://docs.blazingagents.com/api-reference/protocols/service-limits#artifact-batch
[artifacts-session]: https://docs.blazingagents.com/api-reference/protocols/service-limits#artifacts-per-session
[messages]: https://docs.blazingagents.com/api-reference/protocols/service-limits#session-or-task-run-message-page
[concurrent-turns]: https://docs.blazingagents.com/api-reference/protocols/service-limits#concurrent-turns
[concurrent-task-runs]: https://docs.blazingagents.com/api-reference/protocols/service-limits#concurrent-task-runs
[shell-command]: https://docs.blazingagents.com/api-reference/protocols/service-limits#shell-command
[backend-function-call]: https://docs.blazingagents.com/api-reference/protocols/service-limits#backend-function-call
[scheduled-run-start]: https://docs.blazingagents.com/api-reference/protocols/service-limits#scheduled-run-start
[memory-injection]: https://docs.blazingagents.com/api-reference/protocols/service-limits#memory-injection
[artifact-download-url]: https://docs.blazingagents.com/api-reference/protocols/service-limits#artifact-download-url
[workspace-idle-stop]: https://docs.blazingagents.com/api-reference/protocols/service-limits#workspace-idle-stop
[workspace-disk]: https://docs.blazingagents.com/api-reference/protocols/service-limits#workspace-disk
[ws]: https://docs.blazingagents.com/agents/workspaces
