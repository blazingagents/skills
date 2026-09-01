# Artifacts

An Artifact is a deliberately published file deliverable. Model-generated text or structured data is Output; an ordinary Workspace file becomes an Artifact only through publication.

## Decision and workflow

1. Produce the file in a Workspace during a Session or Task Turn.
2. Publish only intended paths through the Artifact Tool flow.
3. Use the public resource for metadata, downloads, and lifecycle choices.

Read [Artifacts](https://docs.blazingagents.com/agents/artifacts) and exact [TypeScript](https://docs.blazingagents.com/sdk/typescript/artifacts), [Python](https://docs.blazingagents.com/sdk/python/artifacts), or [REST](https://docs.blazingagents.com/api-reference/rest-api/artifacts) references.

## Mistakes and verification

Do not call streamed Output an Artifact or treat every Workspace file as published. Verify bytes, provenance/filtering, download, and cleanup. File state belongs to [Workspaces](workspaces.md); generated data belongs to [Output](output/generation-and-streaming.md).
