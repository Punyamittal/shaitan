import { readdir } from "node:fs/promises";
import path from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".cache",
  "__pycache__"
]);

export type ListWorkspaceFilesOptions = {
  maxDepth?: number;
  maxFiles?: number;
};

/**
 * Relative paths under `root` for agent context (no embedding / vector DB).
 */
export async function listWorkspaceRelativeFiles(
  root: string,
  opts: ListWorkspaceFilesOptions = {}
): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? 4;
  const maxFiles = opts.maxFiles ?? 200;
  const out: string[] = [];
  const rootAbs = path.resolve(root);

  async function walk(dirAbs: string, depth: number): Promise<void> {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dirAbs, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(abs, depth + 1);
      } else if (e.isFile()) {
        const rel = path.relative(rootAbs, abs);
        if (rel.startsWith("..")) continue;
        out.push(rel.split(path.sep).join("/"));
      }
    }
  }

  await walk(rootAbs, 0);
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
