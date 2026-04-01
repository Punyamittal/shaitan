/** Shell cwd relative to workspace (per session). Survives duplicate server bundles via globalThis. */

type G = typeof globalThis & {
  __localAiIdeShellCwd?: Map<string, string>;
};

function map(): Map<string, string> {
  const g = globalThis as G;
  if (!g.__localAiIdeShellCwd) g.__localAiIdeShellCwd = new Map();
  return g.__localAiIdeShellCwd;
}

export function getShellCwdRel(sessionId: string): string {
  return map().get(sessionId) ?? "";
}

export function setShellCwdRel(sessionId: string, rel: string): void {
  map().set(sessionId, rel);
}
