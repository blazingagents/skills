# Build a chatbot

Use this reference when implementing send, Stop, text/image resend, editing,
regeneration, or navigation after an interrupted BA interactive Turn.

## Ownership and behavior

BA owns durable Session history. The AI SDK owns live messages and streaming;
TanStack Query (when used) owns saved reads/cache; local state owns draft text and
prepared image URLs. Keep the returned Session ID even after a failed first Turn.
Retain input until a successful terminal finish, and release it on disposal or
credential retirement. Stop requests cancellation and ends local consumption.
After failure or Stop, editing, discard, explicit resend, and navigation remain
available. Suppress duplicate taps synchronously while a submission is active.

Resend uses ordinary submission and a new user-message ID. Regeneration explicitly
replaces saved history, with the old answer preserved on failure/cancellation.
Do not regenerate a failed prompt that was never saved. On reopening, load saved
history normally: a disconnected response may already have committed. External
Tool effects can repeat across attempts. Keep pending approvals and their exact-call
continuation; encountering an approval chunk does not cancel consumption.

## SDK-native example

The [Vite + Hono example](https://github.com/blazingagents/examples/tree/main/vite-hono-ai-sdk)
uses `@blazingagents/sdk` 0.2.0, `ai` 7.0.84, and `@ai-sdk/react` 4.0.87.
The Next.js, TanStack Start, Express, and FastAPI examples use the same input
retention and fresh-submission behavior. Their authenticated relay owns Session
mapping and Tenant credentials. In a distributed end-user app, never embed a
shared Tenant key in this component. The application token below belongs to your
own authenticated backend.

This complete component shows text resend. Keep prepared images in the same local
input state and include their AI SDK file parts on each explicit send; retain
those URLs on failure/Stop and clear them on success/disposal. Load saved history
when reopening a Session; this minimal component displays the current local view.

```tsx
import { useChat } from "@ai-sdk/react";
import { BlazingAgentsChatTransport } from "@blazingagents/sdk";
import { generateId, type UIMessage } from "ai";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

export function App() {
	const [token, setToken] = useState("");
	const [chatInput, setChatInput] = useState("");
	const [sessionId, setSessionId] = useState<string>();
	const active = useRef(false);
	const regenerating = useRef(false);
	const completedMessages = useRef<UIMessage[]>([]);
	useEffect(() => {
		setSessionId(localStorage.getItem("blazing-agents-session") ?? undefined);
	}, []);
	const headers = useMemo(
		() => ({ authorization: `Bearer ${token}` }),
		[token],
	);
	const transport = useMemo(
		() =>
			new BlazingAgentsChatTransport({
				api: "/api/chat",
				headers,
				sessionId,
				onSessionId(id) {
					localStorage.setItem("blazing-agents-session", id);
					setSessionId(id);
				},
			}),
		[headers, sessionId],
	);
	const chat = useChat({
		transport,
		onError() {
			active.current = false;
			chat.setMessages(completedMessages.current);
		},
		onFinish({ isAbort, isError, isDisconnect, finishReason, messages }) {
			active.current = false;
			if (
				!(isAbort || isError || isDisconnect) &&
				finishReason &&
				finishReason !== "error"
			) {
				completedMessages.current = messages;
				// biome-ignore lint/suspicious/noUnnecessaryConditions: Submit and regenerate handlers update this ref before completion.
				if (!regenerating.current) setChatInput("");
			} else {
				chat.setMessages(completedMessages.current);
			}
		},
	});
	const busy = chat.status === "submitted" || chat.status === "streaming";

	function submitChat(event: FormEvent) {
		event.preventDefault();
		// biome-ignore lint/suspicious/noUnnecessaryConditions: Stream callbacks update the synchronous duplicate-submit guard.
		if (active.current || !chatInput.trim()) return;
		active.current = true;
		regenerating.current = false;
		chat.clearError();
		void chat.sendMessage({
			id: generateId(),
			role: "user",
			parts: [{ type: "text", text: chatInput }],
		});
	}
	async function stopChat() {
		await chat.stop();
		active.current = false;
		chat.setMessages(completedMessages.current);
	}
	function regenerate() {
		if (
			// biome-ignore lint/suspicious/noUnnecessaryConditions: Stream callbacks update the synchronous duplicate-submit guard.
			active.current ||
			!completedMessages.current.some((message) => message.role === "assistant")
		)
			return;
		active.current = true;
		regenerating.current = true;
		chat.clearError();
		void chat.regenerate();
	}
	function newSession() {
		localStorage.removeItem("blazing-agents-session");
		setSessionId(undefined);
		completedMessages.current = [];
		chat.setMessages([]);
		chat.clearError();
		setChatInput("");
	}
	return (
		<main
			style={{ fontFamily: "sans-serif", margin: "2rem auto", maxWidth: 720 }}
		>
			<h1>Blazing Agents + Vite + Hono</h1>
			<label>
				Application token{" "}
				<input
					value={token}
					onChange={(event) => setToken(event.target.value)}
				/>
			</label>
			<p>
				Session: {sessionId ?? "new"}{" "}
				<button type="button" onClick={newSession} disabled={busy}>
					New Session
				</button>
			</p>
			{chat.messages.map((message) => (
				<p key={message.id}>
					<strong>{message.role}:</strong>{" "}
					{message.parts
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("")}
				</p>
			))}
			<form onSubmit={submitChat}>
				<input
					aria-label="Message"
					value={chatInput}
					disabled={busy}
					onChange={(event) => setChatInput(event.target.value)}
				/>
				<button type="submit" disabled={busy || !chatInput.trim()}>
					Send / resend
				</button>
				<button type="button" onClick={stopChat} disabled={!busy}>
					Stop
				</button>
				<button type="button" onClick={() => setChatInput("")} disabled={busy}>
					Discard input
				</button>
				<button
					type="button"
					onClick={regenerate}
					disabled={
						busy ||
						!sessionId ||
						!completedMessages.current.some(
							(message) => message.role === "assistant",
						)
					}
				>
					Regenerate
				</button>
			</form>
			{chat.error && <p role="alert">{chat.error.message}</p>}
			<p>
				After an error or Stop, edit or resend your input. Each send is a new
				attempt and may repeat Tool effects. A lost response may already be
				saved.
			</p>
		</main>
	);
}
```

## Python relay submissions

The Python SDK returns raw SSE bytes. Relay them to the AI SDK consumer; HTTP 2xx
or exhausting bytes alone does not establish successful generation. Preserve the
returned ID before relaying. A later user-directed resend can call the same SDK
method with changed text/images and a fresh ID, without a retry API.

```python
from uuid import uuid4
from blazing_agents import BlazingAgents

def submit(client: BlazingAgents, agent_id: str, text: str, session_id: str | None = None):
    options = {"session_id": session_id} if session_id else {}
    return client.chat(
        agent_id=agent_id,
        message={"id": uuid4().hex, "role": "user", "parts": [{"type": "text", "text": text}]},
        **options,
    )

# Your authenticated relay owns the stream and closes it after forwarding:
# with submit(client, agent_id, retained_text, saved_session_id) as stream:
#     save_session_id(stream.session_id)
#     for chunk in stream:
#         forward_to_ai_sdk(chunk)
```

## Chatbot FAQ

1. **Who owns saved history?** BA owns the durable Session transcript. The client
   owns draft input and transient presentation; it does not resend full history.
2. **When is a Session created?** After admission and before the first interactive
   model loop. Use the server-returned ID; failure may leave an empty Session.
3. **What counts as success?** The generation endpoint finishes successfully.
   Clients do not perform a separate settlement check.
4. **What is saved on failure or cancellation?** Executed-attempt usage remains
   recorded; failed or confirmed canceled interactive execution leaves existing
   transcript content unchanged.
5. **Does every Tool error fail the Turn?** No. The Agent can recover from a Tool
   error and complete successfully; such an exchange can be saved normally.
6. **How does Retry work?** Retain the attempted text/images and submit again as
   a new attempt when the user chooses. No outcome polling is required.
7. **Can the user edit before retrying?** Yes. Submit the edited input normally;
   an unsuccessful original prompt is not added to durable context.
8. **Should retry reuse the user-message ID?** No. This design assigns a new ID
   to each submission, including unchanged resend. IDs are not idempotency keys.
9. **How is regeneration different?** It explicitly replaces selected saved
   history. Failure/cancellation preserves the prior answer; success replaces it.
10. **What does Stop guarantee?** It stops local consumption and requests
    cancellation. It does not undo a completed server operation or Tool effect.
11. **What if the connection drops after success?** The exchange may already be
    saved. Load history normally when returning; resend is a new attempt, not
    proof that the previous attempt failed.
12. **What if no Session ID arrived?** A new submission may create a new Session.
    There is no promise of discovering or deduplicating the unseen first one.
13. **What should happen on a busy Session?** Display the error and permit a
    later explicit resend. Do not permanently lock the composer or poll outcomes.
14. **Can Tool effects happen twice?** Yes, if the user repeats an operation.
    Transcript persistence does not roll back effects or guarantee exactly once.
15. **Can users leave after an error or Stop?** Yes. Navigation does not depend on
    a confirmed remote outcome. Submitted input is retained only within the
    existing in-memory controller lifetime unless the product adds draft storage.
16. **How are approvals handled?** Preserve pending requests and exact-call
    continuation. Waiting for approval is not equivalent to failed execution.
17. **Does this change background Tasks?** No. Task runs retain incremental
    transcripts and their existing durable execution lifecycle.
18. **Does this change stateless generation?** No. It still records usage without
    creating a Session transcript.
19. **What belongs in TanStack Query versus the AI SDK?** Saved reads/cache belong
    in Query; live stream/messages belong in the AI SDK; drafts/media remain
    local. None of these needs an ordinary-Turn outcome state machine.
20. **Where do credentials belong?** Tenant credentials belong on the Tenant
    backend for end-user apps. An explicitly authorized native operator client
    using its own key is a distinct support boundary, not permission to embed a
    shared Tenant key in a distributed application.
21. **Do API routes or SDKs need a new retry operation?** No. Existing submission
    operations support the intended user-directed behavior.
22. **Is there a separate settlement definition of success?** No. Success means
    the generation endpoint finishes successfully. The implementation must
    address its current backup and cleanup error paths consistently with that
    behavior; clients do not add a second success check.
