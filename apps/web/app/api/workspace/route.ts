import fs from "node:fs";
import path from "node:path";
import { cwd } from "node:process";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearOpenedWorkspaceRoot, getOpenedWorkspaceRoot, setOpenedWorkspaceRoot } from "@/lib/opened-workspace";

const SESSION_COOKIE = "ide-session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

/** Same session cookie as /api/shell so the PTY WebSocket can tie shell cwd to this browser. */
async function ensureSessionCookie(res: NextResponse): Promise<void> {
  const cookieStore = await cookies();
  if (cookieStore.get(SESSION_COOKIE)?.value) return;
  const sessionId = randomUUID();
  res.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE
  });
}

export async function GET() {
  try {
    const root = getOpenedWorkspaceRoot();
    let suggested = "";
    try {
      suggested = cwd();
    } catch {
      suggested = "";
    }
    const res = NextResponse.json({
      root,
      name: root ? path.basename(root) : null,
      suggestedPath: suggested
    });
    await ensureSessionCookie(res);
    return res;
  } catch (e) {
    return NextResponse.json({
      root: null,
      name: null,
      suggestedPath: "",
      error: e instanceof Error ? e.message : "GET workspace failed"
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { path?: string };
    const raw = body.path?.trim().replace(/^["']+|["']+$/g, "");
    if (!raw) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    const resolved = path.resolve(raw);
    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ error: "Path does not exist" }, { status: 400 });
    }
    if (!fs.statSync(resolved).isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }
    const root = setOpenedWorkspaceRoot(resolved);
    const res = NextResponse.json({ root, name: path.basename(root) });
    await ensureSessionCookie(res);
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid body" }, { status: 400 });
  }
}

export async function DELETE() {
  clearOpenedWorkspaceRoot();
  return NextResponse.json({ ok: true });
}
