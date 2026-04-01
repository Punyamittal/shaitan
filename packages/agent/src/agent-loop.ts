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

export class AgentCore {
  constructor(private readonly deps: AgentDeps) {}

  async run(input: AgentRunInput): Promise<AgentRunOutput> {
    const maxSteps = input.maxSteps ?? 12;
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
          "You are a local AI coding agent. If a tool is needed, return JSON: " +
          '{"action":"tool","tool":"ToolName","input":{}} or {"action":"mcp","tool":"server.tool","input":{}}. ' +
          "When done, return {\"action\":\"final\",\"content\":\"...\"}. " +
          "Tool names (exact): FileReadTool, FileWriteTool, FileEditTool, GrepTool, TerminalTool, BashTool. " +
          `All file and shell tools run with cwd = ${JSON.stringify(input.cwd)}. ` +
          "Use TerminalTool to run shell commands (npm, git, tests, build): it executes in the user's integrated terminal when connected so they see the command and output; otherwise it runs as a subprocess. Use BashTool only if you need a quiet subprocess without the live terminal. " +
          "If vectorless context says there are no candidate files, the workspace may still contain many files — use TerminalTool or BashTool (e.g. dir on Windows, ls on Unix) or FileReadTool on paths from the user message before concluding the folder is empty."
      },
      { role: "system", content: skillPrompt },
      { role: "system", content: vectorlessContext },
      { role: "system", content: templateContext },
      { role: "user", content: input.userPrompt }
    ];

    for (let i = 0; i < maxSteps; i++) {
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

      type AgentAction =
        | { action: "final"; content: string }
        | { action: "tool"; tool: string; input: Record<string, unknown> }
        | { action: "mcp"; tool: string; input: Record<string, unknown> };

      let action: AgentAction;
      try {
        action = parseJson(raw) as AgentAction;
      } catch {
        return {
          finalText: `Model returned invalid JSON. First 800 chars:\n${raw.slice(0, 800)}`,
          toolResults
        };
      }

      if (action.action === "final") {
        return { finalText: action.content, toolResults };
      }

      if (action.action === "tool") {
        const result = await this.runTool(action, input.cwd, input.terminalSessionId);
        toolResults.push(result);
        messages.push({
          role: "tool",
          name: action.tool,
          content: truncateForChat(result.output)
        });
        continue;
      }

      const mcpOutput = await this.deps.mcp.call(action.tool, action.input);
      toolResults.push({ ok: true, tool: action.tool, output: mcpOutput });
      messages.push({
        role: "tool",
        name: action.tool,
        content: truncateForChat(mcpOutput)
      });
    }

    return {
      finalText: "Stopped due to max iteration limit.",
      toolResults
    };
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
