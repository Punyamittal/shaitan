"use client";

import { useEffect, useRef } from "react";
import type { editor } from "monaco-editor";
import { MonacoPanel } from "./MonacoPanel";

function languageForPath(path: string): string {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".jsx") || path.endsWith(".js")) return "javascript";
  return "plaintext";
}

export function EditorPanel({
  path,
  content,
  language,
  onChange,
  onSave,
  onApplyAi,
  canApplyAi,
  onEditorMount,
  readOnly = false
}: {
  path: string;
  content: string;
  language?: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onApplyAi: () => void;
  canApplyAi: boolean;
  onEditorMount?: (editor: editor.IStandaloneCodeEditor) => void;
  readOnly?: boolean;
}) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const lang = language ?? languageForPath(path);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof Element && el.closest(".xterm")) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave]);

  const openFind = () => {
    const ed = editorRef.current;
    ed?.getAction("editor.action.startFind")?.run();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          padding: "8px 12px",
          borderBottom: "1px solid var(--ide-border)",
          background: "var(--ide-bg-elevated)"
        }}
      >
        <span style={{ fontSize: 12, color: "var(--color-neutral)", marginRight: 8 }}>Editor</span>
        <button
          type="button"
          onClick={onSave}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid var(--ide-border)",
            background: "var(--ide-bg-hover)",
            color: "var(--ide-fg)",
            cursor: "pointer",
            fontSize: 12
          }}
        >
          Save
          <span style={{ color: "var(--color-neutral)", marginLeft: 6 }}>Ctrl+S</span>
        </button>
        <button
          type="button"
          disabled={!canApplyAi}
          onClick={onApplyAi}
          title="Apply AI-suggested code from the last response"
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            background: "var(--color-ai-modify)",
            color: "#fff",
            cursor: canApplyAi ? "pointer" : "not-allowed",
            fontSize: 12,
            fontWeight: 600,
            opacity: canApplyAi ? 1 : 0.45
          }}
        >
          Apply AI changes
        </button>
        <button
          type="button"
          onClick={openFind}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid var(--ide-border)",
            background: "transparent",
            color: "var(--ide-fg)",
            cursor: "pointer",
            fontSize: 12
          }}
        >
          Search
        </button>
      </div>
      <MonacoPanel
        path={path || "untitled"}
        content={content}
        language={lang}
        readOnly={readOnly}
        onChange={onChange}
        onEditorMount={(ed) => {
          editorRef.current = ed;
          onEditorMount?.(ed);
        }}
      />
    </div>
  );
}
