import path from "node:path";

/**
 * Next.js may evaluate multiple server bundles; module-level `let` would not be shared.
 * Keep workspace on globalThis so POST /api/workspace and GET /api/fs/list see the same root.
 */
type GlobalWorkspace = typeof globalThis & {
  __localAiIdeOpenedRoot?: string | null;
};

function g(): GlobalWorkspace {
  return globalThis as GlobalWorkspace;
}

export function setOpenedWorkspaceRoot(absPath: string): string {
  const resolved = path.resolve(absPath);
  g().__localAiIdeOpenedRoot = resolved;
  return resolved;
}

export function getOpenedWorkspaceRoot(): string | null {
  const v = g().__localAiIdeOpenedRoot;
  return v ?? null;
}

export function clearOpenedWorkspaceRoot(): void {
  g().__localAiIdeOpenedRoot = null;
}
