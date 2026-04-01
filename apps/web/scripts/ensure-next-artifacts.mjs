/**
 * If `.next` exists but core manifests were never written (interrupted build,
 * deleted mid-dev, or a bad reload), remove it so `next` / `app.prepare()` can
 * recreate a consistent tree. Avoids ENOENT on routes-manifest.json etc.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** @param {string} appRoot Absolute path to the Next app directory (where .next lives). */
export function cleanIncompleteNextDir(appRoot) {
  const nextDir = path.join(appRoot, ".next");
  if (!fs.existsSync(nextDir)) return;

  const routesManifest = path.join(nextDir, "routes-manifest.json");
  // Any non-empty .next without a routes manifest is unusable (common after a bad reload).
  if (fs.existsSync(routesManifest)) return;

  console.warn("[@local-ai-ide/web] Incomplete .next (missing routes-manifest.json); removing for a clean dev build.");
  try {
    fs.rmSync(nextDir, { recursive: true, force: true });
  } catch (e) {
    console.warn("[@local-ai-ide/web] Could not remove .next:", e instanceof Error ? e.message : e);
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  cleanIncompleteNextDir(process.cwd());
}
