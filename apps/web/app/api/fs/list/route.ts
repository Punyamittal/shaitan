import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getOpenedWorkspaceRoot } from "@/lib/opened-workspace";
import { safeResolveInWorkspace } from "@/lib/safe-path";

export type FsEntry = { name: string; kind: "file" | "dir" };

export async function GET(req: Request) {
  const root = getOpenedWorkspaceRoot();
  if (!root) {
    return NextResponse.json({ error: "No workspace opened" }, { status: 400 });
  }
  const url = new URL(req.url);
  const rel = url.searchParams.get("path") ?? "";
  const abs = safeResolveInWorkspace(rel);
  if (abs === null) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return NextResponse.json({ error: "Not a directory" }, { status: 400 });
  }
  const dirents = fs.readdirSync(abs, { withFileTypes: true });
  const entries: FsEntry[] = dirents
    .filter((d) => !d.name.startsWith("."))
    .map((d) => ({
      name: d.name,
      kind: (d.isDirectory() ? "dir" : "file") as FsEntry["kind"]
    }))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  return NextResponse.json({ path: rel, entries });
}
