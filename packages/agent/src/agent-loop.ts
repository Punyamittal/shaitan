import type { ChatMessage, ToolCall, ToolResult } from "@local-ai-ide/shared-types";
import type { OllamaClient } from "@local-ai-ide/ollama-client";
import type { ToolRegistry } from "@local-ai-ide/tools";

export interface SkillProvider {
  buildSkillPrompt(userPrompt: string): Promise<string>;
}

export interface VectorlessProvider {
  buildContext(userPrompt: string, cwd: string): Promise<string>;
}

export interface TemplateProvider {
  maybePrepareTemplate(userPrompt: string): Promise<string>;
}

export interface McpProvider {
  call(tool: string, input: Record<string, unknown>): Promise<string>;
}

export interface AgentDeps {
  model: string;
  ollama: OllamaClient;
  tools: ToolRegistry;
  skills: SkillProvider;
  vectorless: VectorlessProvider;
  templates: TemplateProvider;
  mcp: McpProvider;
}

export interface AgentRunInput {
  userPrompt: string;
  cwd: string;
  maxSteps?: number;
  /** Browser session id (`ide-session` cookie) to target the integrated PTY. */
  terminalSessionId?: string | null;
}

export interface AgentRunOutput {
  finalText: string;
  toolResults: ToolResult[];
}

/** Keep tool lines in chat history bounded so the next Ollama request stays parse-safe. */
const MAX_TOOL_MESSAGE_CHARS = 80_000;

/** Default reasoning/tool turns per agent run (each tool call consumes one step). */
export const DEFAULT_AGENT_MAX_STEPS = 64;

function truncateForChat(s: string): string {
  if (s.length <= MAX_TOOL_MESSAGE_CHARS) return s;
  const n = s.length - MAX_TOOL_MESSAGE_CHARS;
  return `${s.slice(0, MAX_TOOL_MESSAGE_CHARS)}\n\n...[truncated ${n} characters from tool output]`;
}

/**
 * Models sometimes emit Windows paths or broken escapes; JSON requires \\u + 4 hex digits.
 * Turn invalid \\u into a literal backslash + "u..." so JSON.parse can succeed.
 */
function repairInvalidJsonUnicodeEscapes(jsonText: string): string {
  return jsonText.replace(/\\u(?![0-9a-fA-F]{4})/gi, "\\\\u");
}

function asObject(parsed: unknown): Record<string, unknown> | null {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return null;
}

/** Ollama small models often omit `action`, rename fields, or nest JSON as a string. */
function parseStructuredModelJson(raw: string): unknown {
  let v: unknown = parseJson(raw);
  if (typeof v === "string") {
    const t = v.trim();
    try {
      v = JSON.parse(t);
    } catch {
      try {
        v = JSON.parse(repairInvalidJsonUnicodeEscapes(t));
      } catch {
        /* keep string — caller may treat as plain final text */
      }
    }
  }
  return v;
}

const TOOL_NAME_ALIASES: Record<string, string> = {
  terminal: "TerminalTool",
  terminaltool: "TerminalTool",
  shell: "TerminalTool",
  bash: "BashTool",
  bashtool: "BashTool",
  fileread: "FileReadTool",
  filewrite: "FileWriteTool",
  fileedit: "FileEditTool",
  grep: "GrepTool"
};

function resolveRegisteredToolName(raw: string, tools: ToolRegistry): string | null {
  if (tools.has(raw)) return raw;
  const compact = raw.toLowerCase().replace(/[\s_-]/g, "");
  const alias = TOOL_NAME_ALIASES[compact];
  if (alias && tools.has(alias)) return alias;
  for (const t of tools.list()) {
    if (t.name.toLowerCase() === raw.toLowerCase()) return t.name;
  }
  return null;
}

type NormalizedStep =
  | { kind: "final"; content: string }
  | { kind: "tool"; tool: string; input: Record<string, unknown> }
  | { kind: "mcp"; tool: string; input: Record<string, unknown> }
  | { kind: "invalid"; detail: string };

function mergeHoistedShellFields(
  tool: string,
  input: Record<string, unknown>,
  o: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...input };
  if ((tool === "TerminalTool" || tool === "BashTool") && typeof out.command !== "string") {
    const c = o.command;
    if (typeof c === "string" && c.length > 0) out.command = c;
    else if (typeof o.input === "string" && o.input.trim().length > 0) out.command = o.input.trim();
  }
  const tm = o.timeoutMs;
  if (
    (tool === "TerminalTool" || tool === "BashTool") &&
    typeof tm === "number" &&
    typeof out.timeoutMs !== "number"
  ) {
    out.timeoutMs = tm;
  }
  return out;
}

function readToolName(o: Record<string, unknown>): string | undefined {
  const cands = [o.tool, o.name, o.toolName, o.tool_name, o.function, o.functionName];
  for (const c of cands) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return undefined;
}

function readInputObject(o: Record<string, unknown>): Record<string, unknown> {
  const raw = o.input ?? o.arguments ?? o.args ?? o.parameters ?? o.params;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

function readFinalContent(o: Record<string, unknown>): string | undefined {
  for (const k of ["content", "text", "message", "answer", "response", "output"] as const) {
    const v = o[k];
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length > 0) return t;
    }
  }
  return undefined;
}

/**
 * Small models sometimes return arbitrary JSON objects (random keys) instead of agent schema.
 * If we see enough natural-language text in string values, surface it as a final reply.
 */
function tryExtractReplyFromLooseObject(o: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const v of Object.values(o)) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length > 0) parts.push(t);
    }
  }
  if (parts.length === 0) return null;
  const merged = parts.join("\n\n").trim().slice(0, 12_000);
  if (merged.length < 48) return null;
  const words = merged.match(/[a-zA-Z]{4,}/g);
  if (!words || words.length < 4) return null;
  return (
    "*(The model returned JSON without a valid `action` field; showing text extracted from that JSON.)*\n\n" +
    merged
  );
}

const EMPTY_FINAL_FALLBACK =
  "The model ended with an empty message. For requests like “run the project” or “start the server”, " +
  'it must call the terminal first, e.g. {"action":"terminal","input":"npm run dev"} or ' +
  '{"action":"tool","tool":"TerminalTool","input":{"command":"npm start"}}, then use final with a short summary of what ran.';

/** Invalid steps where a follow-up model turn may fix JSON shape (vs unknown tool names, etc.). */
function isRecoverableFormatError(detail: string): boolean {
  return (
    detail.includes("Missing `action`") ||
    detail.includes("Model JSON must") ||
    detail.includes("Ambiguous JSON") ||
    detail.includes('action "tool" requires') ||
    detail.includes('action "mcp" requires') ||
    detail.includes("Unknown action")
  );
}

/**
 * Models often emit {"action":"terminal","input":"npm start"} instead of
 * {"action":"tool","tool":"TerminalTool","input":{"command":"..."}}.
 */
function inferDefaultToolForAction(action: string, tools: ToolRegistry): string | null {
  const a = action.replace(/\s+/g, "").toLowerCase();
  if (["bash", "sh"].includes(a) && tools.has("BashTool")) return "BashTool";
  if (
    ["terminal", "shell", "command", "run", "execute", "exec", "cmd"].includes(a) &&
    tools.has("TerminalTool")
  ) {
    return "TerminalTool";
  }
  return null;
}

function normalizeAgentStep(parsed: unknown, tools: ToolRegistry): NormalizedStep {
  if (typeof parsed === "string") {
    const t = parsed.trim();
    return { kind: "final", content: t.length > 0 ? t : EMPTY_FINAL_FALLBACK };
  }

  const o = asObject(parsed);
  if (!o) {
    return { kind: "invalid", detail: "Model JSON must be a JSON object (or a JSON string of one)." };
  }

  const actionField = o.action ?? o.type ?? o.step;
  let action =
    typeof actionField === "string" ? actionField.trim().toLowerCase().replace(/\s+/g, "") : "";

  let toolRaw = readToolName(o);
  const inputBase = readInputObject(o);
  if (!toolRaw && action) {
    const inferred = inferDefaultToolForAction(action, tools);
    if (inferred) toolRaw = inferred;
  }
  const resolvedLocal = toolRaw ? resolveRegisteredToolName(toolRaw, tools) : null;
  const looksMcp = Boolean(toolRaw?.includes(".") && !resolvedLocal);

  const finalSynonyms = new Set([
    "final",
    "done",
    "complete",
    "answer",
    "reply",
    "respond",
    "result"
  ]);
  const toolSynonyms = new Set([
    "tool",
    "tools",
    "call",
    "invoke",
    "run",
    "execute",
    "exec",
    "terminal",
    "shell",
    "command"
  ]);

  if (!action) {
    if (resolvedLocal) {
      const input = mergeHoistedShellFields(resolvedLocal, inputBase, o);
      return { kind: "tool", tool: resolvedLocal, input };
    }
    if (tools.has("TerminalTool") && typeof o.input === "string" && o.input.trim().length > 0) {
      const input = mergeHoistedShellFields("TerminalTool", inputBase, o);
      return { kind: "tool", tool: "TerminalTool", input };
    }
    if (looksMcp && toolRaw) {
      return { kind: "mcp", tool: toolRaw, input: inputBase };
    }
    const onlyFinal = readFinalContent(o);
    if (onlyFinal && !toolRaw) {
      return { kind: "final", content: onlyFinal };
    }
    if (onlyFinal && toolRaw) {
      return {
        kind: "invalid",
        detail:
          "Ambiguous JSON: both a tool name and a content field were present but `action` was missing."
      };
    }
    const loose = tryExtractReplyFromLooseObject(o);
    if (loose) return { kind: "final", content: loose };
    return {
      kind: "invalid",
      detail:
        'Missing `action`. Use {"action":"tool","tool":"TerminalTool","input":{"command":"..."}}, {"action":"mcp","tool":"server.tool","input":{}}, or {"action":"final","content":"..."}.'
    };
  }

  if (finalSynonyms.has(action)) {
    const fromReader = readFinalContent(o);
    const fromContent =
      typeof o.content === "string" ? o.content.trim() : "";
    const content = fromReader ?? (fromContent.length > 0 ? fromContent : "");
    if (content.length > 0) return { kind: "final", content };
    return { kind: "final", content: EMPTY_FINAL_FALLBACK };
  }

  if (action === "mcp") {
    if (!toolRaw?.includes(".")) {
      return {
        kind: "invalid",
        detail: 'action "mcp" requires tool named like "server.toolName" (MCP qualified name).'
      };
    }
    return { kind: "mcp", tool: toolRaw, input: inputBase };
  }

  if (toolSynonyms.has(action) || action === "tool") {
    if (looksMcp && toolRaw) {
      return { kind: "mcp", tool: toolRaw, input: inputBase };
    }
    if (!resolvedLocal || !toolRaw) {
      return {
        kind: "invalid",
        detail: toolRaw
          ? `Unknown tool "${toolRaw}". Use: FileReadTool, FileWriteTool, FileEditTool, GrepTool, TerminalTool, BashTool.`
          : 'action "tool" requires a "tool" field (e.g. "TerminalTool").'
      };
    }
    const input = mergeHoistedShellFields(resolvedLocal, inputBase, o);
    return { kind: "tool", tool: resolvedLocal, input };
  }

  if (resolvedLocal) {
    const input = mergeHoistedShellFields(resolvedLocal, inputBase, o);
    return { kind: "tool", tool: resolvedLocal, input };
  }
  if (looksMcp && toolRaw) {
    return { kind: "mcp", tool: toolRaw, input: inputBase };
  }

  const looseUnknown = tryExtractReplyFromLooseObject(o);
  if (looseUnknown) return { kind: "final", content: looseUnknown };

  return {
    kind: "invalid",
    detail: `Unknown action "${actionField}". ${resolvedLocal ? "" : "No matching local tool."}`
  };
}

export class AgentCore {
  constructor(private readonly deps: AgentDeps) {}

  async run(input: AgentRunInput): Promise<AgentRunOutput> {
    const maxSteps = input.maxSteps ?? DEFAULT_AGENT_MAX_STEPS;
    const toolResults: ToolResult[] = [];

    let skillPrompt: string;
    let vectorlessContext: string;
    let templateContext: string;
    try {
      skillPrompt = await this.deps.skills.buildSkillPrompt(input.userPrompt);
      vectorlessContext = await this.deps.vectorless.buildContext(input.userPrompt, input.cwd);
      templateContext = await this.deps.templates.maybePrepareTemplate(input.userPrompt);
    } catch (e) {
      return {
        finalText: `Agent setup failed: ${e instanceof Error ? e.message : String(e)}`,
        toolResults: []
      };
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are a local AI coding agent. Every response must be ONE JSON object with a top-level string field \"action\" (required). Do not emit random keys or prose outside JSON. " +
          "If a tool is needed, return JSON: " +
          '{"action":"tool","tool":"ToolName","input":{}} or {"action":"mcp","tool":"server.tool","input":{}}. ' +
          'Shell shorthand (equivalent to TerminalTool): {"action":"terminal","input":{"command":"npm start"}} or {"action":"terminal","input":"npm start"}. ' +
          "When done, return {\"action\":\"final\",\"content\":\"...\"}. " +
          "Tool names (exact): FileReadTool, FileWriteTool, FileEditTool, GrepTool, TerminalTool, BashTool. " +
          `All file and shell tools run with cwd = ${JSON.stringify(input.cwd)}. ` +
          "Use TerminalTool to run shell commands (npm, git, tests, build): it executes in the user's integrated terminal when connected so they see the command and output; otherwise it runs as a subprocess. Use BashTool only if you need a quiet subprocess without the live terminal. " +
          "If vectorless context says there are no candidate files, the workspace may still contain many files — use TerminalTool or BashTool (e.g. dir on Windows, ls on Unix) or FileReadTool on paths from the user message before concluding the folder is empty. " +
          "When the user's request is fully handled, respond with {\"action\":\"final\",\"content\":\"...\"} immediately — do not run extra tools or repeat steps. " +
          "The content field must be a non-empty string (never \"\"). " +
          "If the user asks to run, start, build, or test the project, use TerminalTool or {\"action\":\"terminal\",\"input\":\"...\"} with the right command (e.g. npm run dev, npm start) before using final."
      },
      {
        role: "system",
        content:
          "Examples of VALID JSON responses:\n" +
          '1. Read a file: {"action":"tool","tool":"FileReadTool","input":{"path":"src/index.ts"}}\n' +
          '2. Edit a file: {"action":"tool","tool":"FileEditTool","input":{"path":"src/app.ts","search":"const port = 3000","replace":"const port = 8080"}}\n' +
          '3. Run terminal command: {"action":"terminal","input":"npm run dev"}\n' +
          '4. Search code: {"action":"tool","tool":"GrepTool","input":{"pattern":"function.*login","glob":"*.ts"}}\n' +
          '5. Final answer: {"action":"final","content":"I ran npm run dev in the terminal. Check the terminal panel for output."}\n' +
          "INVALID examples (DO NOT emit these):\n" +
          '- {"customer": "...", "answer": "..."} — missing action field\n' +
          '- {"action": "response", "message": "..."} — action must be "tool", "terminal", "mcp", or "final"\n' +
          '- ```json\\n{"action":"final",...}\\n``` — no markdown code fences, raw JSON only'
      },
      { role: "system", content: skillPrompt },
      { role: "system", content: vectorlessContext },
      { role: "system", content: templateContext },
      { role: "user", content: "Example: run npm install in the terminal" },
      {
        role: "assistant",
        content: JSON.stringify({
          action: "terminal",
          input: "npm install"
        })
      },
      {
        role: "tool",
        name: "TerminalTool",
        content: "[Command executed successfully in terminal]\n\nadded 245 packages in 3.2s"
      },
      {
        role: "assistant",
        content: JSON.stringify({
          action: "final",
          content: "I ran npm install in the terminal. All dependencies were installed successfully."
        })
      },
      { role: "user", content: input.userPrompt }
    ];

    let formatRepairsLeft = 3;
    let stepBudgetNudgeDone = false;
    for (let i = 0; i < maxSteps; i++) {
      if (!stepBudgetNudgeDone && maxSteps >= 4 && i === maxSteps - 3) {
        messages.push({
          role: "system",
          content:
            "STEP BUDGET: Only 3 model turns left after this one. Stop invoking tools unless one last command is strictly necessary; " +
            'otherwise reply with ONLY {"action":"final","content":"brief summary of results and next steps for the user"}.'
        });
        stepBudgetNudgeDone = true;
      }

      let raw: string;
      try {
        raw = await this.deps.ollama.chat({
          model: this.deps.model,
          messages,
          format: "json"
        });
      } catch (e) {
        return {
          finalText: `Ollama request failed: ${e instanceof Error ? e.message : String(e)}`,
          toolResults
        };
      }

      let structured: unknown;
      try {
        structured = parseStructuredModelJson(raw);
      } catch {
        if (formatRepairsLeft > 0) {
          formatRepairsLeft -= 1;
          messages.push({
            role: "system",
            content:
              "PARSE ERROR: Your previous message was not valid JSON. Output exactly one JSON object, no markdown code fences, no text before or after. Valid examples:\n" +
              '{"action":"final","content":"Answer the user here."}\n' +
              '{"action":"terminal","input":"npm run dev"}'
          });
          continue;
        }
        return {
          finalText: `Model returned invalid JSON. First 800 chars:\n${raw.slice(0, 800)}`,
          toolResults
        };
      }

      const step = normalizeAgentStep(structured, this.deps.tools);

      if (step.kind === "final") {
        return { finalText: step.content, toolResults };
      }

      if (step.kind === "invalid") {
        if (formatRepairsLeft > 0 && isRecoverableFormatError(step.detail)) {
          formatRepairsLeft -= 1;
          messages.push({
            role: "system",
            content:
              "FORMAT ERROR: " +
              step.detail +
              "\n\nYour next message must be one JSON object with \"action\". Examples:\n" +
              '{"action":"final","content":"…"}\n' +
              '{"action":"tool","tool":"TerminalTool","input":{"command":"…"}}\n' +
              "Invalid output began with: " +
              JSON.stringify(raw.slice(0, 220))
          });
          continue;
        }
        return {
          finalText: `${step.detail}\n\nRaw model output (first 600 chars):\n${raw.slice(0, 600)}`,
          toolResults
        };
      }

      if (step.kind === "tool") {
        const result = await this.runTool(step, input.cwd, input.terminalSessionId);
        toolResults.push(result);
        messages.push({
          role: "tool",
          name: step.tool,
          content: truncateForChat(result.output)
        });
        continue;
      }

      const mcpOutput = await this.deps.mcp.call(step.tool, step.input);
      toolResults.push({ ok: true, tool: step.tool, output: mcpOutput });
      messages.push({
        role: "tool",
        name: step.tool,
        content: truncateForChat(mcpOutput)
      });
    }

    const synthesized = await this.synthesizeAfterStepLimit(
      toolResults,
      input.userPrompt,
      input.cwd,
      maxSteps
    );
    return {
      finalText: synthesized,
      toolResults
    };
  }

  /**
   * When the main loop never receives `final`, ask the model once for a no-tools summary,
   * or fall back to a compact dump of recent tool output so the user still sees something useful.
   */
  private async synthesizeAfterStepLimit(
    toolResults: ToolResult[],
    userPrompt: string,
    cwd: string,
    maxSteps: number
  ): Promise<string> {
    const header = `Step limit reached (${maxSteps} rounds, ${toolResults.length} tool runs). `;

    const recent = toolResults.slice(-16);
    const brief =
      recent.length === 0
        ? "(No tool outputs recorded.)"
        : recent
            .map(
              (t, idx) =>
                `--- ${idx + 1}. ${t.tool} (${t.ok ? "ok" : "error"}) ---\n${t.output.slice(0, 4000)}` +
                (t.output.length > 4000 ? "\n...[truncated]" : "")
            )
            .join("\n\n");

    try {
      const raw = await this.deps.ollama.chat({
        model: this.deps.model,
        messages: [
          {
            role: "system",
            content:
              "The coding agent hit its tool-step limit. You must NOT use any tools. " +
              'Reply with ONLY valid JSON: {"action":"final","content":"..."}. ' +
              "In content, summarize what the tools accomplished, errors, and concrete next steps. " +
              `User request (trimmed): ${userPrompt.slice(0, 3000)}\n` +
              `Workspace cwd: ${JSON.stringify(cwd)}`
          },
          {
            role: "user",
            content: `Tool trace (most recent first, truncated):\n${brief.slice(0, 28_000)}`
          }
        ],
        format: "json",
        temperature: 0.1
      });
      const structured = parseStructuredModelJson(raw);
      const step = normalizeAgentStep(structured, this.deps.tools);
      if (step.kind === "final" && step.content.trim().length > 0) {
        return `${header}\n${step.content.trim()}`;
      }
    } catch {
      /* use fallback below */
    }

    if (toolResults.length === 0) {
      return (
        `${header}The model never returned a final answer and no tools ran. ` +
        "Try a shorter prompt, a different model, or raise `maxSteps` / env `AGENT_MAX_STEPS`."
      );
    }

    const listing = recent
      .map(
        (t, idx) =>
          `**${idx + 1}. ${t.tool}** (${t.ok ? "ok" : "error"})\n\`\`\`text\n${t.output.slice(0, 2000)}` +
          (t.output.length > 2000 ? "\n...[truncated]" : "") +
          "\n```"
      )
      .join("\n\n");

    return (
      `${header}Automatic summary failed; showing the last ${recent.length} tool outputs.\n\n${listing}\n\n` +
      "You can raise the limit (`maxSteps` in the API body or `AGENT_MAX_STEPS` in the environment) or ask a narrower question."
    );
  }

  private async runTool(
    call: ToolCall,
    cwd: string,
    terminalSessionId?: string | null
  ): Promise<ToolResult> {
    try {
      const tool = this.deps.tools.get(call.tool);
      const input = tool.inputSchema.parse(call.input);
      const output = await tool.execute(input, { cwd, terminalSessionId });
      return { ok: true, tool: call.tool, output };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, tool: call.tool, output: `Tool error: ${msg}` };
    }
  }
}

function parseJson(text: string): unknown {
  const candidates = [text.trim(), text.replace(/```json|```/g, "").trim()].filter(Boolean);
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      try {
        return JSON.parse(repairInvalidJsonUnicodeEscapes(c));
      } catch {
        /* try next candidate */
      }
    }
  }
  throw new SyntaxError("Could not parse model JSON");
}
