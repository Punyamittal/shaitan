# 1. 🧭 HIGH LEVEL DESIGN (HLD)

See [`docs/HLD.md`](docs/HLD.md) for the full architecture and flow.

# 2. ⚙️ LOW LEVEL DESIGN (LLD)

See [`docs/LLD.md`](docs/LLD.md) for module contracts and interaction design.

# 3. 📁 PROJECT STRUCTURE

```text
local-ai-ide/
├── apps/
│   └── web/
│       ├── app/
│       │   ├── api/agent/run/route.ts
│       │   ├── globals.css
│       │   ├── layout.tsx
│       │   └── page.tsx
│       ├── components/
│       │   ├── ChatPanel.tsx
│       │   ├── FileExplorer.tsx
│       │   └── MonacoPanel.tsx
│       ├── next.config.ts
│       ├── package.json
│       └── tsconfig.json
├── claude-code/                         (existing external source)
├── skills/
│   ├── refactor-safe-edit/SKILL.md
│   └── ui-template-assembler/SKILL.md
├── vectorless/
│   └── README.md
├── templates/
│   ├── dashboard/AnalyticsDashboard.tsx
│   ├── hero/GradientHero.tsx
│   ├── navbar/ModernNavbar.tsx
│   └── manifest.json
├── docs/
│   ├── HLD.md
│   └── LLD.md
├── packages/
│   ├── agent/src/agent-loop.ts
│   ├── mcp-client/src/mcp-client.ts
│   ├── ollama-client/src/index.ts
│   ├── shared-types/src/index.ts
│   ├── skills-runtime/src/skill-loader.ts
│   ├── template-engine/src/template-selector.ts
│   ├── tools/src/tool-registry.ts
│   ├── tools/src/types.ts
│   ├── tools/src/tools/bash-tool.ts
│   ├── tools/src/tools/file-edit-tool.ts
│   ├── tools/src/tools/file-read-tool.ts
│   ├── tools/src/tools/file-write-tool.ts
│   └── tools/src/tools/grep-tool.ts
├── package.json
└── tsconfig.base.json
```

# 4. 🔑 CORE IMPLEMENTATION (REAL CODE)

## Agent Loop
- `packages/agent/src/agent-loop.ts`: iterative planner/executor loop.
- Supports:
  - tool execution (`action=tool`)
  - MCP execution (`action=mcp`)
  - skill/vectorless/template prompt injection
  - bounded reasoning turns (`maxSteps`)

## Tool Interface + Example Tools
- `packages/tools/src/types.ts` defines strict interface:
  - `name`, `description`, `inputSchema`, `execute()`
- Required tools implemented in `packages/tools/src/tools/`:
  - `FileReadTool`
  - `FileWriteTool`
  - `FileEditTool`
  - `GrepTool`
  - `BashTool`

## Skill Loader
- `packages/skills-runtime/src/skill-loader.ts`
- Dynamically loads `skills/<skill-name>/SKILL.md`
- Parses frontmatter + instructions and injects relevant skills into prompt context

## Vectorless Selector
- `packages/vectorless-engine/src/selector.ts`
- Stage 1: LLM chooses relevant files from metadata
- Stage 2: LLM chooses relevant line ranges from selected file previews
- Returns only selected snippets as context (no embeddings, no vector DB)

## Template Selector + Adapter
- `packages/template-engine/src/template-selector.ts`
- Reads `templates/manifest.json`
- Selects templates through LLM reasoning
- Adapts selected template source according to user request
- Enforces template-first generation (select + modify)

## MCP Client
- `packages/mcp-client/src/mcp-client.ts`
- Implements server registry, stdio MCP connection, tool listing, and tool invocation via `server.tool`
- Supports external MCP tools, including `browser.fetch` when present

# 5. 🔄 END-TO-END EXECUTION FLOW

1. User prompt enters `apps/web` chat panel.
2. `POST /api/agent/run` initializes `AgentCore`.
3. `SkillLoader` injects task-specific skill instructions.
4. `VectorlessSelector` performs:
   - file selection
   - section selection
5. `TemplateEngine` selects and adapts local templates.
6. Agent loop plans actions and calls:
   - local tools (file/search/bash)
   - MCP tools (`server.tool`)
7. Tool/MCP outputs feed back into loop.
8. Agent returns final response to UI.
9. Monaco panel displays generated/edited code output.

# 6. ⚠️ DESIGN CONSTRAINTS

- Runs locally with Ollama (`http://127.0.0.1:11434`)
- No vector DB and no embedding-based retrieval
- Modular packages with clear contracts
- No monolithic runtime; each subsystem is replaceable
- Web UI is Next.js-based and ready to be wrapped in Tauri/Electron later

# 7. 🚀 MVP BUILD PLAN

## Phase 1 (Day 1-2): Core Runtime
- workspace bootstrap
- strict tool contracts + required tools
- agent loop with bounded execution

## Phase 2 (Day 3): Context + Skills
- dynamic skill loading from SKILL.md
- vectorless file/section selection pipeline

## Phase 3 (Day 4): UI Generation + MCP
- template metadata library + selector + adapter
- MCP registry and external tool calls

## Phase 4 (Day 5): Product Surface
- React + Monaco UI
- API endpoint wiring + flow integration
- smoke tests and hardening

# 8. 🔥 OPTIONAL ADVANCED FEATURES

- Multi-agent execution coordinator with role-specialized workers
- Persistent local memory graph (file-level, task-level)
- Skill marketplace manifest and signed skill bundles
- Plugin ecosystem for custom tools and custom UI blocks

## Run Locally

```bash
cd local-ai-ide
npm install
npm run dev:web
```

Set optional env vars (e.g. in `apps/web/.env.local`):

```bash
# Must match a model you have pulled (`ollama list`). Default is qwen3:4b.
# Examples: qwen3:4b, llama3.2, llama3.2:3b, llava, mistral, phi3:mini, gemma3:4b
OLLAMA_MODEL=llama3.2
# If Ollama listens elsewhere (e.g. Docker):
# OLLAMA_BASE_URL=http://127.0.0.1:11434
```

If you see **`404 Not Found`** from Ollama while the daemon is running, the **model name is wrong or not installed** — not a dead server. Run `ollama pull <name>` or set `OLLAMA_MODEL` to a model from `ollama list`.
# shaitan
