"use client";

import Editor from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import type { editor } from "monaco-editor";

function configureMonacoWorkers() {
  const g = globalThis as typeof globalThis & {
    MonacoEnvironment?: {
      getWorker: (_: string, label: string) => Worker;
    };
  };

  if (g.MonacoEnvironment?.getWorker) return;

  g.MonacoEnvironment = {
    getWorker: (_: string, label: string) => {
      if (label === "typescript" || label === "javascript") {
        return new Worker(
          new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url)
        );
      }
      return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url));
    }
  };
}

export function MonacoPanel({
  path,
  content,
  language = "json",
  onChange,
  onEditorMount,
  readOnly = false
}: {
  path: string;
  content: string;
  language?: string;
  onChange?: (value: string) => void;
  onEditorMount?: (editor: editor.IStandaloneCodeEditor) => void;
  readOnly?: boolean;
}) {
  const crumbs = path.split("/").filter(Boolean);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: "1 1 0%",
        minHeight: 0,
        minWidth: 0,
        height: "100%"
      }}
    >
      <div
        style={{
          padding: "4px 12px",
          fontSize: 12,
          color: "var(--ide-fg-muted)",
          borderBottom: "1px solid var(--ide-border)",
          background: "var(--ide-bg-elevated)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis"
        }}
      >
        {crumbs.length === 0 ? (
          <span style={{ color: "var(--color-neutral)" }}>No file open</span>
        ) : (
          crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span style={{ margin: "0 6px" }}>{">"}</span>}
              <span style={{ color: i === crumbs.length - 1 ? "var(--ide-fg)" : undefined }}>{c}</span>
            </span>
          ))
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          height="100%"
          path={path}
          language={language}
          theme="vs-dark"
          value={content}
          onChange={(v) => onChange?.(v ?? "")}
          onMount={(ed) => {
            onEditorMount?.(ed);
          }}
          beforeMount={(_monaco: typeof Monaco) => {
            configureMonacoWorkers();
          }}
          options={{
            readOnly,
            minimap: { enabled: true, scale: 0.75 },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily: "Consolas, 'Courier New', monospace",
            padding: { top: 8 },
            renderLineHighlight: "line",
            bracketPairColorization: { enabled: true }
          }}
        />
      </div>
    </div>
  );
}
