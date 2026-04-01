import { spawn } from "node:child_process";
import path from "node:path";
import { cwd } from "node:process";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getOpenedWorkspaceRoot } from "@/lib/opened-workspace";
import { getShellCwdRel, setShellCwdRel } from "@/lib/shell-sessions";

function safeRelUnderBase(baseRoot: string, rel: string): string | null {
  const absNorm = path.resolve(baseRoot, rel);
  const back = path.relative(path.resolve(baseRoot), absNorm);
  if (back.startsWith("..") || path.isAbsolute(back)) return null;
  return absNorm;
}

function runCommand(line: string, cwdAbs: string): Promise<{ out: string; code: number | null }> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const shell = isWin ? "cmd.exe" : "/bin/sh";
    const args = isWin ? ["/d", "/s", "/c", line] : ["-c", line];
    const child = spawn(shell, args, {
      cwd: cwdAbs,
      env: process.env,
      windowsHide: true
    });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.on("close", (code) => {
      resolve({ out, code });
    });
    child.on("error", (err) => {
      resolve({ out: `${err.message}\n`, code: 1 });
    });
  });
}

export async function POST(req: Request) {
  const baseRoot = getOpenedWorkspaceRoot() ?? cwd();

  const cookieStore = await cookies();
  let sessionId = cookieStore.get("ide-session")?.value;
  const newSession = !sessionId;
  if (!sessionId) sessionId = randomUUID();

  const body = (await req.json()) as { line?: string };
  const line = (body.line ?? "").replace(/\r$/, "");
  const trimmed = line.trim();

  let cwdRel = getShellCwdRel(sessionId);
  const cwdAbs = path.resolve(baseRoot, cwdRel);

  if (!trimmed) {
    const res = NextResponse.json({ out: "", cwd: cwdRel });
    if (newSession) {
      res.cookies.set("ide-session", sessionId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7
      });
    }
    return res;
  }

  const cdNoArg = /^cd\s*$/i.test(trimmed);
  if (cdNoArg) {
    setShellCwdRel(sessionId, "");
    const res = NextResponse.json({ out: "", cwd: "" });
    if (newSession) {
      res.cookies.set("ide-session", sessionId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7
      });
    }
    return res;
  }

  const cdWithArg = /^cd\s+(.+)$/i.exec(trimmed);
  if (cdWithArg) {
    const targetRaw = cdWithArg[1].trim().replace(/^["']|["']$/g, "");
    const currentAbs = safeRelUnderBase(baseRoot, cwdRel) ?? path.resolve(baseRoot);
    const nextAbs = path.resolve(currentAbs, targetRaw);
    const relBack = path.relative(path.resolve(baseRoot), nextAbs);
    if (relBack.startsWith("..") || path.isAbsolute(relBack)) {
      const res = NextResponse.json({ out: `cd: ${targetRaw}: Invalid path\n`, cwd: cwdRel });
      if (newSession) {
        res.cookies.set("ide-session", sessionId, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 7
        });
      }
      return res;
    }
    const nextRel = relBack.split(path.sep).join("/").replace(/\\/g, "/");
    setShellCwdRel(sessionId, nextRel);
    const res = NextResponse.json({ out: "", cwd: nextRel });
    if (newSession) {
      res.cookies.set("ide-session", sessionId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7
      });
    }
    return res;
  }

  const { out, code } = await runCommand(trimmed, cwdAbs);
  let text = out;
  if (code !== 0 && code !== null) {
    text += `\n[exit ${code}]`;
  }
  const res = NextResponse.json({ out: text, cwd: cwdRel });
  if (newSession) {
    res.cookies.set("ide-session", sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7
    });
  }
  return res;
}
