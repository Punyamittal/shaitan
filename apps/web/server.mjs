/**
 * Custom Next.js server with a WebSocket that bridges to a real PTY (node-pty).
 * The in-app xterm connects to /_terminal/ws for a real interactive shell.
 */
import { createServer } from "node:http";
import net from "node:net";
import { parse } from "node:url";
import { randomUUID } from "node:crypto";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import { spawn as ptySpawn } from "node-pty";
import { cleanIncompleteNextDir } from "./scripts/ensure-next-artifacts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";

/**
 * When PORT is unset, find a free port starting at 3000 so `EADDRINUSE` does not kill dev.
 * When PORT is set, use it exactly (fail if busy).
 */
function pickListenPort() {
  const requested = parseInt(process.env.PORT || "3000", 10);
  if (process.env.PORT) {
    return Promise.resolve(requested);
  }
  return new Promise((resolve, reject) => {
    let port = requested;
    const max = requested + 25;
    const tryListen = () => {
      if (port > max) {
        reject(new Error(`No free port between ${requested} and ${max - 1}`));
        return;
      }
      const probe = net.createServer();
      probe.once("error", (err) => {
        if (err.code === "EADDRINUSE") {
          port += 1;
          tryListen();
        } else {
          reject(err);
        }
      });
      probe.listen({ port, host: hostname }, () => {
        probe.close(() => resolve(port));
      });
    };
    tryListen();
  });
}

cleanIncompleteNextDir(__dirname);

/** @param {import('http').IncomingMessage} req */
function getCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function getOpenedWorkspaceRoot() {
  return globalThis.__localAiIdeOpenedRoot ?? null;
}

/** @param {string} sessionId */
function getShellCwdRel(sessionId) {
  const m = globalThis.__localAiIdeShellCwd;
  if (!m || !(m instanceof Map)) return "";
  return m.get(sessionId) ?? "";
}

function resolveShellCwd(sessionId) {
  const baseRoot = getOpenedWorkspaceRoot() ?? process.cwd();
  const rel = getShellCwdRel(sessionId);
  const abs = path.resolve(baseRoot, rel);
  const back = path.relative(path.resolve(baseRoot), abs);
  if (back.startsWith("..") || path.isAbsolute(back)) return baseRoot;
  return abs;
}

function createPty(cwd) {
  const isWin = process.platform === "win32";
  let file;
  let args;
  if (isWin) {
    file = "powershell.exe";
    args = ["-NoLogo"];
  } else {
    file = process.env.SHELL || "/bin/bash";
    args = ["-l"];
  }
  return ptySpawn(file, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: process.env
  });
}

const wss = new WebSocketServer({ noServer: true });

/** @type {Map<string, import('node-pty').IPty>} */
const ptyBySession =
  (globalThis.__localAiIdePtyBySession ??= new Map());

wss.on("connection", (ws, req) => {
  const sessionId = getCookie(req, "ide-session") ?? randomUUID();
  const cwd = resolveShellCwd(sessionId);

  let term;
  try {
    term = createPty(cwd);
  } catch (e) {
    ws.close(1011, e instanceof Error ? e.message : "pty failed");
    return;
  }

  ptyBySession.set(sessionId, term);

  term.onData((data) => {
    if (ws.readyState === 1) ws.send(data);
  });

  term.onExit(({ exitCode, signal }) => {
    ptyBySession.delete(sessionId);
    if (ws.readyState === 1) {
      const sig = signal != null ? ` signal ${signal}` : "";
      ws.send(`\r\n\x1b[90m[Process exited code ${exitCode}${sig}]\x1b[0m\r\n`);
    }
    ws.close();
  });

  ws.on("message", (data) => {
    const str = typeof data === "string" ? data : data.toString("utf8");
    if (str.startsWith("{")) {
      try {
        const msg = JSON.parse(str);
        if (
          msg &&
          msg.type === "resize" &&
          Number.isFinite(msg.cols) &&
          Number.isFinite(msg.rows) &&
          msg.cols > 0 &&
          msg.rows > 0
        ) {
          term.resize(Math.floor(msg.cols), Math.floor(msg.rows));
          return;
        }
      } catch {
        /* fall through — user input */
      }
    }
    term.write(str);
  });

  ws.on("close", () => {
    ptyBySession.delete(sessionId);
    try {
      term.kill();
    } catch {
      /* ignore */
    }
  });
});

/** @type {import('http').Server | undefined} */
let httpServer;

async function main() {
  const port = await pickListenPort();
  if (!process.env.PORT && port !== 3000) {
    console.warn(`[@local-ai-ide/web] Port 3000 is in use; dev server is on http://${hostname}:${port}`);
  }

  const app = next({ dev, hostname, port, dir: __dirname });
  const handle = app.getRequestHandler();

  await app.prepare();

  const init = app.init;
  if (!init?.upgradeHandler) {
    throw new Error("Next.js init.upgradeHandler missing after prepare()");
  }
  const nextUpgrade = init.upgradeHandler;

  app.didWebSocketSetup = true;

  httpServer = createServer((req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error handling request", err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  httpServer.on("upgrade", async (req, socket, head) => {
    try {
      const pathname = parse(req.url || "", true).pathname || "";
      if (pathname === "/_terminal/ws") {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
        return;
      }
      await nextUpgrade(req, socket, head);
    } catch (err) {
      console.error("upgrade error:", err);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, hostname, () => {
      httpServer.off("error", reject);
      resolve(undefined);
    });
  });

  console.log(`> Ready on http://${hostname}:${port} (PTY terminal at /_terminal/ws)`);
}

main().catch((err) => {
  if (err && err.code === "EADDRINUSE") {
    const p = process.env.PORT || "3000";
    console.error(
      `[@local-ai-ide/web] Port ${p} is already in use.\n` +
        `  Stop the other process, or set PORT to a free port, e.g.  PORT=3001  npm run dev\n` +
        `  (PowerShell)  Get-NetTCPConnection -LocalPort ${p} | Select OwningProcess`
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});
