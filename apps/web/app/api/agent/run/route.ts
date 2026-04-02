import { cwd } from "node:process";
import { join } from "node:path";
import { access } from "node:fs/promises";
import type { FileCandidate } from "@local-ai-ide/vectorless-engine";
import { NextResponse } from "next/server";
import { getOpenedWorkspaceRoot } from "@/lib/opened-workspace";
import { listWorkspaceRelativeFiles } from "@/lib/workspace-file-index";
import { AgentCore, DEFAULT_AGENT_MAX_STEPS } from "@local-ai-ide/agent";
import { McpClientRegistry } from "@local-ai-ide/mcp-client";
import { OllamaClient } from "@local-ai-ide/ollama-client";
import { SkillLoader } from "@local-ai-ide/skills-runtime";
import { TemplateEngine } from "@local-ai-ide/template-engine";
import {
  BashTool,
  FileEditTool,
  FileReadTool,
  FileWriteTool,
  GrepTool,
  TerminalTool,
  ToolRegistry
} from "@local-ai-ide/tools";
import { cookies } from "next/headers";
import { VectorlessSelector } from "@local-ai-ide/vectorless-engine";

const MAX_CONTEXT = 200_000;

const VECTORLESS_CANDIDATES: FileCandidate[] = [
  { path: "claude-code/README.md", summary: "Claude Code architecture and tools." },
  { path: "skills/README.md", summary: "Anthropic-style skill format and usage." },
  { path: "vectorless/README.md", summary: "Vectorless no-embedding approach." }
];

function workspaceFileCandidates(paths: string[]): FileCandidate[] {
  const score = (p: string) => {
    const lower = p.toLowerCase();
    if (lower.endsWith("readme.md") || lower.endsWith("readme.txt")) return 0;
    if (lower === "package.json" || lower.endsWith("/package.json")) return 1;
    if (lower.endsWith(".md") || lower.endsWith(".txt")) return 2;
    if (lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml")) return 3;
    return 4;
  };
  return [...paths]
    .sort((a, b) => score(a) - score(b) || a.localeCompare(b))
    .slice(0, 40)
    .map((path) => ({ path, summary: `File in workspace: ${path}` }));
}

async function vectorlessCandidatesForWorkspace(root: string): Promise<FileCandidate[]> {
  const out: FileCandidate[] = [];
  for (const c of VECTORLESS_CANDIDATES) {
    try {
      await access(join(root, c.path));
      out.push(c);
    } catch {
      // Workspace does not include monorepo docs — skip.
    }
  }
  try {
    const listed = await listWorkspaceRelativeFiles(root, { maxDepth: 4, maxFiles: 120 });
    const seen = new Set(out.map((o) => o.path));
    for (const c of workspaceFileCandidates(listed)) {
      if (!seen.has(c.path)) {
        seen.add(c.path);
        out.push(c);
      }
    }
  } catch {
    /* ignore listing errors */
  }
  return out;
}

const MAX_STEPS_CAP = 100;
const MAX_STEPS_FLOOR = 4;

function resolveAgentMaxSteps(body: { maxSteps?: unknown }): number {
  const envParsed = parseInt(process.env.AGENT_MAX_STEPS ?? "", 10);
  const fromEnv =
    Number.isFinite(envParsed) && envParsed >= MAX_STEPS_FLOOR
      ? Math.min(MAX_STEPS_CAP, envParsed)
      : DEFAULT_AGENT_MAX_STEPS;
  const req = body.maxSteps;
  if (typeof req === "number" && Number.isFinite(req)) {
    return Math.min(MAX_STEPS_CAP, Math.max(MAX_STEPS_FLOOR, Math.floor(req)));
  }
  return fromEnv;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      prompt: string;
      mode?: string;
      model?: string;
      maxSteps?: number;
      files?: { path: string; content: string }[];
    };
    let composed = body.prompt ?? "";
    if (body.mode && body.mode !== "auto") {
      composed = `[Mode: ${body.mode}]\n\n${composed}`;
    }
    if (body.files?.length) {
      const block = body.files.map((f) => `### ${f.path}\n${f.content}`).join("\n\n");
      composed = `${composed}\n\n--- Open files ---\n${block}`;
    }
    const workspaceRoot = (await resolveWorkspaceRoot()) ?? cwd();

    let fileIndexNote = "";
    try {
      const listed = await listWorkspaceRelativeFiles(workspaceRoot, { maxDepth: 4, maxFiles: 250 });
      if (listed.length) {
        const lines = listed.join("\n");
        const cap = 120_000;
        fileIndexNote =
          `\n\n--- Workspace file index (${listed.length} paths under ${workspaceRoot}) ---\n` +
          (lines.length > cap ? `${lines.slice(0, cap)}\n...[truncated]` : lines);
      } else {
        fileIndexNote = `\n\n--- Workspace file index: (no files listed under ${workspaceRoot}) ---`;
      }
    } catch (e) {
      fileIndexNote = `\n\n--- Workspace file index: (list failed: ${e instanceof Error ? e.message : String(e)}) ---`;
    }

    composed += fileIndexNote;

    if (composed.length > MAX_CONTEXT) {
      composed = composed.slice(0, MAX_CONTEXT) + "\n\n[truncated]";
    }
    const envModel = process.env.OLLAMA_MODEL ?? "qwen3:4b";
    const requested = typeof body.model === "string" ? body.model.trim() : "";
    const model =
      /^[\w.+\-/:]+$/.test(requested) && requested.length <= 200 ? requested : envModel;

    const weakModels = ["phi3", "phi4", "gemma3:4b", "tinyllama", "orca-mini"];
    const isWeak = weakModels.some((w) => model.toLowerCase().includes(w));
    if (isWeak) {
      console.warn(
        `[@local-ai-ide/agent] Model "${model}" may not follow agent JSON schema reliably. ` +
          "For autonomous file editing and terminal commands, use qwen2.5:7b, deepseek-coder:6.7b, or llama3.1:8b. " +
          "Run: ollama pull qwen2.5:7b"
      );
    }

    const ollama = new OllamaClient();
    const tools = new ToolRegistry();
    tools.register(new FileReadTool());
    tools.register(new FileWriteTool());
    tools.register(new FileEditTool());
    tools.register(new GrepTool());
    tools.register(new TerminalTool());
    tools.register(new BashTool());

    const skills = new SkillLoader(join(workspaceRoot, "skills"));
    const vectorless = new VectorlessSelector(ollama, model);
    const templates = new TemplateEngine(join(workspaceRoot, "templates"), ollama, model);
    const mcp = new McpClientRegistry();

    const vectorCandidates = await vectorlessCandidatesForWorkspace(workspaceRoot);

    const agent = new AgentCore({
      model,
      ollama,
      tools,
      skills,
      templates,
      vectorless: {
        buildContext: async (userPrompt: string, agentCwd: string) =>
          vectorless.buildContext(userPrompt, agentCwd, vectorCandidates)
      },
      mcp
    });

    const cookieStore = await cookies();
    const terminalSessionId = cookieStore.get("ide-session")?.value ?? null;

    const maxSteps = resolveAgentMaxSteps(body);

    const result = await agent.run({
      userPrompt: composed,
      cwd: workspaceRoot,
      terminalSessionId,
      maxSteps
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function resolveWorkspaceRoot(): Promise<string | null> {
  const opened = getOpenedWorkspaceRoot();
  if (opened) return opened;

  const current = cwd();
  const candidates = [current, join(current, ".."), join(current, "../..")];

  for (const root of candidates) {
    try {
      await access(join(root, "skills"));
      await access(join(root, "templates"));
      await access(join(root, "claude-code"));
      await access(join(root, "vectorless"));
      return root;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}
