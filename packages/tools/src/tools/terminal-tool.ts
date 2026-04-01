import { spawn } from "node:child_process";
import { platform } from "node:process";
import { z } from "zod";
import type { Tool } from "../types";

const TerminalSchema = z.object({
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().default(120_000)
});

type PtyLike = {
  write(data: string): void;
  on(event: "data", listener: (data: string | Buffer) => void): void;
  removeListener(event: "data", listener: (data: string | Buffer) => void): void;
};

function getPtyMap(): Map<string, PtyLike> | undefined {
  const g = globalThis as typeof globalThis & {
    __localAiIdePtyBySession?: Map<string, PtyLike>;
  };
  return g.__localAiIdePtyBySession;
}

/** Join multiple lines into one shell line (PowerShell uses `;`, POSIX uses `&&`). */
function oneLineCommand(command: string): string {
  const lines = command
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return lines[0] ?? "";
  const sep = platform === "win32" ? "; " : " && ";
  return lines.join(sep);
}

function runViaSubprocess(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, {
      cwd,
      shell: true
    });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      clearTimeout(timer);
      const parts: string[] = [];
      if (code !== 0) {
        parts.push(`[exit code ${code}]`);
      }
      if (err.trim()) parts.push(err.trim());
      if (out.trim()) parts.push(out.trim());
      if (code === 0) {
        resolve(parts.join("\n").trim() || "OK");
      } else {
        reject(new Error(parts.join("\n") || `Command failed: ${code}`));
      }
    });
  });
}

function runViaPty(pty: PtyLike, command: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const maxBuf = 200_000;
    let buf = "";
    const onData = (data: string | Buffer) => {
      const chunk = typeof data === "string" ? data : data.toString("utf8");
      buf += chunk;
      if (buf.length > maxBuf) {
        buf = buf.slice(-maxBuf);
      }
    };
    pty.on("data", onData);
    const line = oneLineCommand(command);
    if (!line) {
      pty.removeListener("data", onData);
      reject(new Error("Empty command"));
      return;
    }
    try {
      pty.write(`${line}\r`);
    } catch (e) {
      pty.removeListener("data", onData);
      reject(e);
      return;
    }
    const t = setTimeout(() => {
      pty.removeListener("data", onData);
      const preview = buf.trim() || "(no output captured in this window)";
      resolve(
        `[Integrated terminal]\n${preview}\n\n` +
          `[Capture stopped after ${timeoutMs}ms; the shell keeps running in the panel. For longer jobs, increase timeoutMs or run in the terminal manually.]`
      );
    }, timeoutMs);
    t.unref?.();
  });
}

export class TerminalTool implements Tool<typeof TerminalSchema> {
  name = "TerminalTool";
  description =
    "Run a shell command in the workspace. When the user has the in-app terminal connected (same browser session), the command is typed into that live PTY so they see it in the terminal panel; output is also captured for you. If no live session exists, runs as a subprocess (same as BashTool). Prefer this over BashTool when the user should see commands in the integrated terminal. Input: command (one line or multiple lines joined with && or ;), timeoutMs (default 120000).";
  inputSchema = TerminalSchema;

  async execute(input: z.infer<typeof TerminalSchema>, ctx: { cwd: string; terminalSessionId?: string | null }): Promise<string> {
    const sessionId = ctx.terminalSessionId?.trim();
    const map = getPtyMap();
    if (sessionId && map?.has(sessionId)) {
      const pty = map.get(sessionId)!;
      return runViaPty(pty, input.command, input.timeoutMs);
    }
    const note =
      "[No live terminal WebSocket for this session — ran via subprocess instead. Open the terminal in the IDE and ensure the workspace path is applied so agent commands can use the integrated PTY.]\n\n";
    try {
      const out = await runViaSubprocess(input.command, ctx.cwd, input.timeoutMs);
      return note + out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(note + msg);
    }
  }
}
