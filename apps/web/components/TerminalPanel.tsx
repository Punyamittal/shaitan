"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";

import "@xterm/xterm/css/xterm.css";

/** When Monaco/body still holds focus after clicking the terminal, inject this stroke into xterm. */
function keyEventToTerminalData(e: KeyboardEvent): string | null {
  if (e.isComposing) return null;
  if (e.key === "Enter") return "\r";
  if (e.key === "Backspace") return "\u007f";
  if (e.key === "Tab") return "\t";
  if (e.key === "Escape") return "\u001b";
  if (e.key === "ArrowUp") return "\u001b[A";
  if (e.key === "ArrowDown") return "\u001b[B";
  if (e.key === "ArrowRight") return "\u001b[C";
  if (e.key === "ArrowLeft") return "\u001b[D";
  if (e.key === "Delete") return "\u001b[3~";
  if (e.key === "Home") return "\u001b[H";
  if (e.key === "End") return "\u001b[F";
  if (e.key === " ") return " ";
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return e.key;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !e.shiftKey) return "\x03";
  return null;
}

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/_terminal/ws`;
}

function focusXterm(term: Terminal) {
  term.focus();
  const ta = term.textarea;
  if (ta) {
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
  const surfaceActiveRef = useRef(false);

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
      disableStdin: false,
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
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    fit.fit();
    focusXterm(term);
    requestAnimationFrame(() => {
      if (closed) return;
      fit.fit();
      focusXterm(term);
    });

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

    // Track “user is using the terminal” vs rest of IDE (for keyboard fallback).
    // Treat the whole panel (toolbar + xterm) as terminal UI so toolbar clicks still enable typing.
    const onDocMouseDownCapture = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      surfaceActiveRef.current = Boolean(host?.contains(t));
    };

    // Only on the xterm mount node (not the toolbar): blur anything that still owns focus
    // (Monaco hidden textarea, AI composer, etc.), then focus xterm.
    const grabFocusMouse = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (!(t instanceof Node) || !container.contains(t)) return;
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && !container.contains(ae)) {
        ae.blur();
      }
      if (!closed) focusXterm(term);
    };

    document.addEventListener("mousedown", onDocMouseDownCapture, true);
    container.addEventListener("mousedown", grabFocusMouse, true);

    const onWindowKeyDownCapture = (e: KeyboardEvent) => {
      if (closed || !surfaceActiveRef.current) return;
      const ta = term.textarea;
      if (!ta || document.activeElement === ta) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") return;

      const ae = document.activeElement;
      if (ae instanceof Element && ae.closest("[data-ide-ai-panel]")) return;

      const monacoFocused = ae instanceof Element && ae.closest(".monaco-editor");
      const nowhereFocused =
        ae === null ||
        ae === document.body ||
        ae === document.documentElement;
      // After clicking the terminal, Monaco can still own focus; route keys to the PTY anyway.
      if (!surfaceActiveRef.current && !monacoFocused && !nowhereFocused) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        e.stopImmediatePropagation();
        ta.focus({ preventScroll: true });
        void navigator.clipboard.readText().then((text) => {
          if (!closed && text) term.paste(text);
        });
        return;
      }

      const data = keyEventToTerminalData(e);
      if (data === null) {
        if (["Control", "Shift", "Alt", "Meta", "CapsLock", "ContextMenu"].includes(e.key)) {
          ta.focus({ preventScroll: true });
        }
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();
      ta.focus({ preventScroll: true });
      term.input(data, true);
    };

    window.addEventListener("keydown", onWindowKeyDownCapture, true);

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
        document.removeEventListener("mousedown", onDocMouseDownCapture, true);
        window.removeEventListener("keydown", onWindowKeyDownCapture, true);
        container.removeEventListener("mousedown", grabFocusMouse, true);
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
        surfaceActiveRef.current = true;
        term.writeln("\x1b[90mShell in your linked project folder (PTY).\x1b[0m\r\n");
        sendResize();
        requestAnimationFrame(() => focusXterm(term));
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
      document.removeEventListener("mousedown", onDocMouseDownCapture, true);
      window.removeEventListener("keydown", onWindowKeyDownCapture, true);
      container.removeEventListener("mousedown", grabFocusMouse, true);
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
        minHeight: "var(--panel-terminal-height)",
        maxHeight: "var(--panel-terminal-height)",
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
        data-ide-terminal-surface
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
