import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool } from "../types";

const GrepSchema = z.object({
  pattern: z.string().min(1),
  glob: z.string().optional()
});

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".css",
  ".html",
  ".xml",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".cs",
  ".php",
  ".rb",
  ".sh",
  ".ps1",
  ".sql",
  ".toml",
  ".ini",
  ".env",
  ".properties"
]);

export class GrepTool implements Tool<typeof GrepSchema> {
  name = "GrepTool";
  description = "Search file content with ripgrep (rg), or a built-in scan if rg is not installed.";
  inputSchema = GrepSchema;

  async execute(input: z.infer<typeof GrepSchema>, ctx: { cwd: string }): Promise<string> {
    const rgFirst = await tryRipgrep(input, ctx.cwd);
    if (rgFirst !== null) return rgFirst;
    return naiveGrep(input.pattern, input.glob, ctx.cwd);
  }
}

async function tryRipgrep(
  input: z.infer<typeof GrepSchema>,
  cwd: string
): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const args = ["-n", input.pattern];
    if (input.glob) args.push("--glob", input.glob);
    args.push(".");
    const proc = spawn("rg", args, { cwd, shell: true });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", () => finish(null));
    proc.on("close", (code) => {
      if (code === 0 || code === 1) finish(out.trim() || err || "No matches");
      else finish(null);
    });
  });
}

function globToMatcher(glob: string | undefined): (file: string) => boolean {
  if (!glob) return () => true;
  const g = glob.replace(/^[*./]+/, "").toLowerCase();
  if (!g) return () => true;
  return (file: string) => file.toLowerCase().includes(g) || file.toLowerCase().endsWith(g);
}

async function naiveGrep(pattern: string, glob: string | undefined, root: string): Promise<string> {
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const matchGlob = globToMatcher(glob);
  const linesOut: string[] = [];
  const maxLines = 400;
  const maxFileBytes = 400_000;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6 || linesOut.length >= maxLines) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (linesOut.length >= maxLines) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (e.isDirectory()) {
        await walk(abs, depth + 1);
      } else if (e.isFile()) {
        if (!matchGlob(rel)) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (ext && !TEXT_EXT.has(ext)) continue;
        try {
          const st = await stat(abs);
          if (st.size > maxFileBytes) continue;
        } catch {
          continue;
        }
        await grepFile(abs, rel, re, linesOut, maxLines);
      }
    }
  }

  await walk(path.resolve(root), 0);
  if (!linesOut.length) return "No matches (built-in grep; install ripgrep `rg` for faster search).";
  return linesOut.slice(0, maxLines).join("\n");
}

async function grepFile(
  abs: string,
  rel: string,
  re: RegExp,
  linesOut: string[],
  maxLines: number
): Promise<void> {
  return new Promise((resolve) => {
    const stream = createReadStream(abs, { encoding: "utf8" });
    let lineNum = 0;
    let buf = "";
    stream.on("data", (chunk: string | Buffer) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) {
        lineNum += 1;
        if (linesOut.length >= maxLines) {
          stream.destroy();
          return;
        }
        if (re.test(line)) linesOut.push(`${rel}:${lineNum}:${line}`);
      }
    });
    stream.on("end", () => {
      if (buf && linesOut.length < maxLines) {
        lineNum += 1;
        if (re.test(buf)) linesOut.push(`${rel}:${lineNum}:${buf}`);
      }
      resolve();
    });
    stream.on("error", () => resolve());
  });
}
