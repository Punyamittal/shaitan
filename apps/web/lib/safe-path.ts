import fs from "node:fs";
import path from "node:path";
import { getOpenedWorkspaceRoot } from "./opened-workspace";

/** Resolve a workspace-relative path to an absolute path, or null if traversal escapes the workspace. */
export function safeResolveInWorkspace(rel: string): string | null {
  const root = getOpenedWorkspaceRoot();
  if (!root) return null;
  const rootNorm = path.resolve(root);
  const absNorm = path.resolve(rootNorm, rel);
  const back = path.relative(rootNorm, absNorm);
  if (back.startsWith("..") || path.isAbsolute(back)) return null;
  return absNorm;
}

export function assertPathInWorkspace(absPath: string): boolean {
  const root = getOpenedWorkspaceRoot();
  if (!root) return false;
  const rootNorm = path.resolve(root);
  const absNorm = path.resolve(absPath);
  const back = path.relative(rootNorm, absNorm);
  return !(back.startsWith("..") || path.isAbsolute(back));
}

export function pathExistsAsDir(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}
