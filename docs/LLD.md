# 2. Low Level Design

## Modules and Responsibilities

- `packages/agent`: Planner/executor loop and action dispatch.
- `packages/tools`: Tool interface, registry, and concrete tool implementations.
- `packages/skills-runtime`: SKILL.md parsing, indexing, and prompt construction.
- `packages/vectorless-engine`: 2-stage file/section relevance selection.
- `packages/template-engine`: Template manifest loading, selection, adaptation.
- `packages/mcp-client`: MCP server client lifecycle and tool invocation.
- `packages/ollama-client`: Local model chat API wrapper.
- `apps/web`: Next.js UI + API wiring.

## Interfaces and Contracts

- **Tool contract** (`packages/tools/src/types.ts`):
  - `name`
  - `description`
  - `inputSchema`
  - `execute(input, ctx)`
- **Agent dependencies** (`packages/agent/src/agent-loop.ts`):
  - skill provider, vectorless provider, template provider, tool registry, MCP provider, Ollama client.
- **Skill format**:
  - `skills/<skill-name>/SKILL.md` with frontmatter fields `name`, `description`.
- **Template metadata**:
  - `templates/manifest.json` with `name`, `tags`, `framework`, `style`, `file`.

## Data Structures

- `ChatMessage`: normalized role/content message format for LLM calls.
- `ToolCall`: structured action for local tool execution.
- `ToolResult`: captured tool response injected back into loop context.
- `FileCandidate`: lightweight file descriptor used in vectorless stage-1 selection.
- `FileSection`: bounded snippet coordinates for stage-2 context materialization.

## Interaction Map

1. **Agent -> Skills**: prompt-conditioned skill extraction.
2. **Agent -> Vectorless**: obtains relevant snippets for prompt grounding.
3. **Agent -> Template Engine**: obtains selected/adapted local template output.
4. **Agent -> Tools**: structured local execution.
5. **Agent -> MCP**: external capability calls via `server.tool`.
6. **Agent -> Ollama**: loop reasoning and action planning.

## Safety and Extensibility

- Local-first defaults and no embedding dependency.
- Bounded loop via `maxSteps`.
- Schema-validated tool inputs.
- Loose-coupled providers allow replacement (e.g., different model/runtime/UI shell).
