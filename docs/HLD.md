# 1. High Level Design

## ASCII Architecture Diagram

```text
+---------------------+         +-----------------------------+
| React + Monaco UI   | <-----> | Next.js API (local server) |
| - Chat panel        |         | - /api/agent/run           |
| - Editor panel      |         +-------------+---------------+
| - File explorer     |                       |
+----------+----------+                       v
           |                      +-----------------------------+
           |                      | Agent Core                  |
           |                      | Planner + Execution Loop    |
           |                      +--+----+-----+------+--------+
           |                         |    |     |      |
           |                         |    |     |      |
           |      +------------------+    |     |      +-------------------+
           |      |                       |     |                          |
           v      v                       v     v                          v
+-----------------------+    +----------------+  +----------------+  +--------------------+
| Skill Loader          |    | Vectorless     |  | Template Engine|  | MCP Client Registry |
| skills/*/SKILL.md     |    | File+Section   |  | Select+Adapt   |  | server.tool calls   |
+-----------------------+    | Selector       |  +----------------+  +--------------------+
                             +--------+-------+
                                      |
                                      v
                             +-----------------+
                             | Ollama (local)  |
                             | /api/chat       |
                             +-----------------+

                +--------------------+
                | Tool Registry      |
                | File/Bash/Grep/... |
                +--------------------+
```

## Component Purpose

- **UI Layer**: Web shell for prompt input, result display, and code editing.
- **Agent Core**: Iterative planner/executor that reasons, invokes tools/MCP, and converges.
- **Tool System**: Deterministic local operations (read/write/edit/search/bash).
- **Skills Runtime**: Dynamic SKILL.md loader and task-conditioned prompt injection.
- **Vectorless Engine**: Relevance selection without embeddings (files first, then sections).
- **Template Engine**: Metadata-driven template selection and adaptation.
- **MCP Layer**: Connects external capabilities via server/tool contracts.
- **Ollama Client**: Local LLM inference entrypoint.

## Data Flow

1. User sends prompt from chat panel.
2. API route initializes agent dependencies.
3. Skill loader selects active instructions from `skills/*/SKILL.md`.
4. Vectorless engine asks LLM to pick relevant files, then relevant sections.
5. Template engine asks LLM to pick local templates and adapt them.
6. Agent enters iterative loop and requests tool/MCP actions as JSON.
7. Tool registry executes local tools; MCP registry executes remote MCP tools.
8. Results are fed back into the loop until a final response is emitted.
9. UI renders final output and execution trace-ready details.
