"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";

import "@xterm/xterm/css/xterm.css";

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/_terminal/ws`;
}

function focusXterm(term: Terminal, container: HTMLElement) {
  term.focus();
  const ta = container.querySelector(".xterm-helper-textarea");
  if (ta instanceof HTMLTextAreaElement) {
    ta.focus({ preventScroll: true });
  }
}

export function TerminalPanel({
  workspaceLinked,
  projectOpen
}: {
  workspaceLinked: boolean;
  projectOpen: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const clearTerminal = useCallback(() => {
    termRef.current?.clear();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const host = hostRef.current;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "Consolas, 'Courier New', monospace",
      fontSize: 12,
      screenReaderMode: false,
      theme: {
        background: "#1e1e1e",
        foreground: "#cccccc",
        cursor: "#cccccc"
      }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fit.fit();
    focusXterm(term, container);

    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const sendResize = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      fit.fit();
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    term.onData((data) => {
      const w = wsRef.current;
      if (w?.readyState === WebSocket.OPEN) {
        w.send(data);
        return;
      }
      if (data === "\r" || data === "\n") {
        term.writeln("\r\n\x1b[33mNot connected to shell (WebSocket closed). Check dev server / port.\x1b[0m");
      }
    });

    const grabFocus = (e: PointerEvent) => {
      if (e.button !== 0) return;
      queueMicrotask(() => {
        if (!closed) focusXterm(term, container);
      });
    };

    host?.addEventListener("pointerdown", grabFocus, true);
    container.addEventListener("pointerdown", grabFocus, true);

    if (!workspaceLinked) {
      if (!projectOpen) {
        term.writeln(
          "\x1b[33mOpen a project folder from the sidebar first.\x1b[0m\r\n" +
            "\x1b[90mThen paste that folder’s full disk path here and click Apply so the shell starts there.\x1b[0m\r\n"
        );
      } else {
        term.writeln(
          "\x1b[33mPaste the same folder’s full path in the bar below and click Apply.\x1b[0m\r\n" +
            "\x1b[90mExample: C:\\\\Users\\\\You\\\\my-repo — the browser cannot read this path from the picker.\x1b[0m\r\n"
        );
      }
      const roIdle = new ResizeObserver(() => fit.fit());
      roIdle.observe(container);
      return () => {
        closed = true;
        host?.removeEventListener("pointerdown", grabFocus, true);
        container.removeEventListener("pointerdown", grabFocus, true);
        roIdle.disconnect();
        term.dispose();
        termRef.current = null;
      };
    }

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        term.writeln("\x1b[90mShell in your linked project folder (PTY).\x1b[0m\r\n");
        sendResize();
        requestAnimationFrame(() => focusXterm(term, container));
      };

      ws.onmessage = (ev: MessageEvent<string | Blob>) => {
        void (async () => {
          if (typeof ev.data === "string") {
            term.write(ev.data);
            return;
          }
          if (ev.data instanceof Blob) {
            term.write(await ev.data.text());
          }
        })();
      };

      ws.onerror = () => {
        term.writeln("\r\n\x1b[31mWebSocket error — run the app with node server.mjs (npm run dev in apps/web).\x1b[0m\r\n");
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (closed) return;
        term.writeln("\r\n\x1b[33mTerminal disconnected. Reconnecting in 2s…\x1b[0m\r\n");
        reconnectTimer = setTimeout(connect, 2000);
      };
    };

    connect();

    const ro = new ResizeObserver(() => sendResize());
    ro.observe(container);

    return () => {
      closed = true;
      host?.removeEventListener("pointerdown", grabFocus, true);
      container.removeEventListener("pointerdown", grabFocus, true);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const w = wsRef.current;
      wsRef.current = null;
      try {
        w?.close();
      } catch {
        /* ignore */
      }
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [workspaceLinked, projectOpen]);

  return (
    <div
      ref={hostRef}
      className="ide-terminal-host"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "var(--panel-terminal-height)",
        minHeight: 140,
        borderTop: "1px solid var(--ide-border)",
        background: "var(--ide-terminal-bg)",
        flexShrink: 0
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          borderBottom: "1px solid var(--ide-border)",
          background: "var(--ide-bg-elevated)",
          fontSize: 12,
          color: "var(--color-neutral)"
        }}
      >
        <span style={{ fontWeight: 600 }}>Terminal</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={clearTerminal}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid var(--ide-border)",
              background: "var(--ide-bg-hover)",
              color: "var(--ide-fg)",
              cursor: "pointer",
              fontSize: 12
            }}
          >
            Clear
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        role="presentation"
        style={{
          flex: 1,
          minHeight: 0,
          padding: 4,
          overflow: "hidden",
          cursor: "text"
        }}
      />
    </div>
  );
}
