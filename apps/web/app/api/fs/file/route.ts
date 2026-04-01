import fs from "node:fs";
import { NextResponse } from "next/server";
import { getOpenedWorkspaceRoot } from "@/lib/opened-workspace";
import { safeResolveInWorkspace } from "@/lib/safe-path";

export async function GET(req: Request) {
  const root = getOpenedWorkspaceRoot();
  if (!root) {
    return NextResponse.json({ error: "No workspace opened" }, { status: 400 });
  }
  const url = new URL(req.url);
  const rel = url.searchParams.get("path") ?? "";
  if (!rel) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  const abs = safeResolveInWorkspace(rel);
  if (abs === null) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return NextResponse.json({ error: "Not a file" }, { status: 400 });
  }
  const content = fs.readFileSync(abs, "utf8");
  return NextResponse.json({ path: rel, content });
}

export async function PUT(req: Request) {
  const root = getOpenedWorkspaceRoot();
  if (!root) {
    return NextResponse.json({ error: "No workspace opened" }, { status: 400 });
  }
  try {
    const body = (await req.json()) as { path?: string; content?: string };
    const rel = body.path?.trim();
    if (!rel) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    const abs = safeResolveInWorkspace(rel);
    if (abs === null) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    fs.writeFileSync(abs, body.content ?? "", "utf8");
    return NextResponse.json({ ok: true, path: rel });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Write failed" }, { status: 500 });
  }
}
