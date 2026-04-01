"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

export type AgentMode = "auto" | "ui_builder" | "backend" | "debug";

export type AiStatusPhase = "idle" | "thinking" | "planning" | "executing" | "done";

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  logs?: string[];
  error?: boolean;
};

export type AgentConversation = {
  id: string;
  title: string;
  messages: AgentChatMessage[];
  draft: string;
  mode: AgentMode;
  lastRun: { prompt: string; mode: AgentMode } | null;
};

const MODE_LABELS: Record<AgentMode, string> = {
  auto: "Auto",
  ui_builder: "UI Builder",
  backend: "Backend",
  debug: "Debug"
};

function phaseLabel(p: AiStatusPhase): string {
  switch (p) {
    case "thinking":
      return "Thinking…";
    case "planning":
      return "Planning…";
    case "executing":
      return "Running tools…";
    case "done":
      return "Done";
    default:
      return "Ready";
  }
}

const tabBarBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--ide-fg-muted)",
  fontSize: 12,
  cursor: "pointer",
  maxWidth: 140,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis"
};

export function AIPanel({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onCloseConversation,
  onDraftChange,
  onModeChange,
  models,
  selectedModel,
  onModelChange,
  modelsError,
  onRun,
  onStop,
  onRetry,
  running,
  statusPhase,
  canRetry
}: {
  conversations: AgentConversation[];
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onCloseConversation: (id: string) => void;
  onDraftChange: (v: string) => void;
  onModeChange: (m: AgentMode) => void;
  models: string[];
  selectedModel: string;
  onModelChange: (m: string) => void;
  modelsError?: string | null;
  onRun: () => void;
  onStop: () => void;
  onRetry: () => void;
  running: boolean;
  statusPhase: AiStatusPhase;
  canRetry: boolean;
}) {
  const active = conversations.find((c) => c.id === activeConversationId) ?? conversations[0];
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [active?.messages.length, active?.messages, running]);

  const draft = active?.draft ?? "";
  const mode = active?.mode ?? "auto";

  return (
    <section
      style={{
        width: "var(--panel-ai-width)",
        minWidth: 300,
        maxWidth: 520,
        borderLeft: "1px solid var(--ide-border)",
        background: "var(--ide-bg)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "8px 10px",
          borderBottom: "1px solid var(--ide-border)",
          background: "var(--ide-bg-elevated)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ide-fg)" }}>Agent</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
          <span style={{ color: "var(--color-neutral)" }}>Status</span>
          <span
            style={{
              color:
                statusPhase === "done"
                  ? "var(--color-success)"
                  : running
                    ? "var(--color-ai-primary)"
                    : "var(--ide-fg-muted)",
              fontWeight: 600
            }}
          >
            {phaseLabel(statusPhase)}
          </span>
        </div>
      </div>

      {/* Conversation tabs */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 8px",
          borderBottom: "1px solid var(--ide-border)",
          background: "#1a1a1c",
          overflowX: "auto",
          flexShrink: 0
        }}
      >
        {conversations.map((c) => {
          const sel = c.id === activeConversationId;
          return (
            <div key={c.id} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              <button
                type="button"
                title={c.title}
                onClick={() => onSelectConversation(c.id)}
                style={{
                  ...tabBarBtn,
                  background: sel ? "var(--ide-bg-active)" : "transparent",
                  borderColor: sel ? "var(--ide-border)" : "transparent",
                  color: sel ? "var(--ide-fg)" : "var(--ide-fg-muted)"
                }}
              >
                {c.title}
              </button>
              {conversations.length > 1 && (
                <button
                  type="button"
                  aria-label={`Close ${c.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseConversation(c.id);
                  }}
                  style={{
                    marginLeft: -4,
                    padding: "2px 6px",
                    border: "none",
                    background: "transparent",
                    color: "var(--ide-fg-muted)",
                    cursor: "pointer",
                    borderRadius: 4,
                    fontSize: 14,
                    lineHeight: 1
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={onNewConversation}
          title="New conversation"
          style={{
            ...tabBarBtn,
            flexShrink: 0,
            color: "var(--color-ai-primary)",
            fontWeight: 600
          }}
        >
          + New
        </button>
      </div>

      {/* Scrollable history */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "12px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          background: "#1e1e22"
        }}
      >
        {active && active.messages.length === 0 && !running && (
          <div
            style={{
              fontSize: 12,
              color: "var(--ide-fg-muted)",
              lineHeight: 1.5,
              padding: "8px 4px"
            }}
          >
            Ask the agent to read files, run commands, or edit the project. Each tab keeps its own history.
          </div>
        )}
        {active?.messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
              gap: 6
            }}
          >
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--color-neutral)"
              }}
            >
              {msg.role === "user" ? "You" : "Agent"}
            </div>
            <div
              style={{
                maxWidth: "94%",
                padding: "10px 12px",
                borderRadius: 10,
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background:
                  msg.role === "user"
                    ? "linear-gradient(135deg, #2d3a5c 0%, #2a3348 100%)"
                    : msg.error
                      ? "#3d2424"
                      : "#2a2a2e",
                border:
                  msg.role === "user"
                    ? "1px solid rgba(99, 130, 200, 0.25)"
                    : "1px solid var(--ide-border)",
                color: "var(--ide-fg)"
              }}
            >
              {msg.content}
            </div>
            {msg.role === "assistant" && msg.logs && msg.logs.length > 0 && (
              <details
                style={{
                  maxWidth: "94%",
                  fontSize: 11,
                  color: "var(--ide-fg-muted)"
                }}
              >
                <summary style={{ cursor: "pointer", userSelect: "none" }}>Execution log</summary>
                <pre
                  style={{
                    margin: "8px 0 0",
                    padding: 8,
                    background: "#121214",
                    borderRadius: 6,
                    overflow: "auto",
                    maxHeight: 160,
                    fontFamily: "Consolas, monospace",
                    lineHeight: 1.45
                  }}
                >
                  {msg.logs.join("\n")}
                </pre>
              </details>
            )}
          </div>
        ))}
        {running && (
          <div style={{ fontSize: 12, color: "var(--color-ai-primary)", fontStyle: "italic" }}>
            Agent is working…
          </div>
        )}
      </div>

      {/* Composer (Cursor-style) */}
      <div
        style={{
          borderTop: "1px solid var(--ide-border)",
          background: "var(--ide-bg-elevated)",
          padding: "10px 10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flexShrink: 0
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 11, color: "var(--color-neutral)", flex: "0 0 auto" }}>Model</label>
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={running}
            style={{
              flex: "1 1 140px",
              minWidth: 120,
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid var(--ide-border)",
              background: "var(--ide-input-bg)",
              color: "var(--ide-fg)",
              fontSize: 12
            }}
          >
            {models.length === 0 && <option value={selectedModel}>{selectedModel || "Default"}</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <label style={{ fontSize: 11, color: "var(--color-neutral)" }}>Mode</label>
          <select
            value={mode}
            onChange={(e) => onModeChange(e.target.value as AgentMode)}
            disabled={running}
            style={{
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid var(--ide-border)",
              background: "var(--ide-input-bg)",
              color: "var(--ide-fg)",
              fontSize: 12
            }}
          >
            {(Object.keys(MODE_LABELS) as AgentMode[]).map((k) => (
              <option key={k} value={k}>
                {MODE_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        {modelsError && (
          <div style={{ fontSize: 11, color: "var(--color-warning)" }}>Models: {modelsError}</div>
        )}
        <textarea
          rows={3}
          placeholder="Plan, search, explain, or request edits… (@ for context in a future update)"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          disabled={running}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (!running && draft.trim()) onRun();
            }
          }}
          style={{
            width: "100%",
            resize: "none",
            background: "#252526",
            color: "var(--ide-fg)",
            border: "1px solid var(--ide-border)",
            borderRadius: 8,
            padding: "10px 12px",
            fontFamily: "inherit",
            fontSize: 13,
            lineHeight: 1.45,
            minHeight: 72
          }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            disabled={running || !draft.trim()}
            onClick={onRun}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "var(--color-ai-primary)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 12,
              cursor: running || !draft.trim() ? "not-allowed" : "pointer",
              opacity: running || !draft.trim() ? 0.55 : 1
            }}
          >
            Run
          </button>
          <button
            type="button"
            disabled={!running}
            onClick={onStop}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--ide-border)",
              background: running ? "#3d2424" : "transparent",
              color: "var(--ide-fg)",
              fontSize: 12,
              cursor: !running ? "not-allowed" : "pointer",
              opacity: !running ? 0.45 : 1
            }}
          >
            Stop
          </button>
          <button
            type="button"
            disabled={running || !canRetry}
            onClick={onRetry}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--ide-border)",
              background: "transparent",
              color: "var(--ide-fg-muted)",
              fontSize: 12,
              cursor: running || !canRetry ? "not-allowed" : "pointer",
              opacity: running || !canRetry ? 0.45 : 1
            }}
          >
            Retry last
          </button>
          <span style={{ fontSize: 10, color: "var(--color-neutral)", marginLeft: "auto" }}>
            Ctrl+Enter run
          </span>
        </div>
      </div>
    </section>
  );
}
