"use client";

import type { CSSProperties } from "react";
import type { DirEntry } from "../lib/client-fs";

function joinRel(parent: string, name: string): string {
  if (!parent) return name;
  return `${parent.replace(/\/$/, "")}/${name}`;
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <span style={{ width: 16, fontSize: 10, color: "var(--color-neutral)", userSelect: "none" }}>
      {expanded ? "▼" : "▶"}
    </span>
  );
}

function Row({
  depth,
  name,
  isDir,
  expanded,
  selected,
  onClick
}: {
  depth: number;
  name: string;
  isDir: boolean;
  expanded: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="treeitem"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "2px 8px",
        paddingLeft: 4 + depth * 12,
        cursor: "pointer",
        background: selected ? "var(--ide-bg-active)" : "transparent",
        fontSize: 13,
        lineHeight: "22px",
        borderRadius: 2
      }}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.background = "var(--ide-bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    >
      {isDir ? <Chevron expanded={expanded} /> : <span style={{ width: 16 }} />}
      <span style={{ marginLeft: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
    </div>
  );
}

function TreeLevel({
  parentPath,
  depth,
  entries,
  cache,
  expanded,
  toggle,
  selectedPath,
  onSelectFile,
  onEnsureLoaded
}: {
  parentPath: string;
  depth: number;
  entries: DirEntry[];
  cache: Record<string, DirEntry[]>;
  expanded: Set<string>;
  toggle: (p: string, before: () => Promise<void>) => void;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onEnsureLoaded: (path: string) => Promise<void>;
}) {
  return (
    <>
      {entries.map((e) => {
        const rel = joinRel(parentPath, e.name);
        const isDir = e.kind === "dir";
        const isOpen = expanded.has(rel);
        const selected = selectedPath === rel;
        return (
          <div key={rel}>
            <Row
              depth={depth}
              name={e.name}
              isDir={isDir}
              expanded={isOpen}
              selected={selected}
              onClick={() => {
                if (isDir) void toggle(rel, async () => onEnsureLoaded(rel));
                else onSelectFile(rel);
              }}
            />
            {isDir && isOpen && cache[rel] !== undefined && (
              <TreeLevel
                parentPath={rel}
                depth={depth + 1}
                entries={cache[rel] ?? []}
                cache={cache}
                expanded={expanded}
                toggle={toggle}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                onEnsureLoaded={onEnsureLoaded}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export function FileExplorerPanel({
  projectLabel,
  hasRoot,
  pickerSupported,
  rootEntries,
  cache,
  expanded,
  toggleExpand,
  selectedPath,
  onSelectFile,
  onEnsureLoaded,
  onOpenProject,
  onNewFile,
  onDelete,
  onRefresh
}: {
  projectLabel: string;
  hasRoot: boolean;
  pickerSupported: boolean;
  rootEntries: DirEntry[] | null;
  cache: Record<string, DirEntry[]>;
  expanded: Set<string>;
  toggleExpand: (path: string, before: () => Promise<void>) => void;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onEnsureLoaded: (path: string) => Promise<void>;
  onOpenProject: () => void;
  onNewFile: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  return (
    <aside
      style={{
        width: "var(--panel-explorer-width)",
        minWidth: 200,
        maxWidth: 360,
        background: "var(--ide-bg-elevated)",
        borderRight: "1px solid var(--ide-border)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--ide-border)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-neutral)"
        }}
      >
        Files
      </div>
      <div style={{ padding: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button
          type="button"
          title={pickerSupported ? "Pick a folder on your machine" : "Use Chrome or Edge"}
          disabled={!pickerSupported}
          onClick={onOpenProject}
          style={btnPrimary}
        >
          Open Project
        </button>
        <button type="button" disabled={!hasRoot} onClick={onNewFile} style={btnNeutral}>
          New File
        </button>
        <button type="button" disabled={!hasRoot || !selectedPath} onClick={onDelete} style={btnDanger}>
          Delete
        </button>
        <button type="button" disabled={!hasRoot} onClick={onRefresh} style={btnNeutral}>
          Refresh
        </button>
      </div>
      {!pickerSupported && (
        <p style={{ margin: "0 12px 8px", fontSize: 11, color: "var(--color-warning)" }}>
          Directory picker needs a Chromium-based browser (Chrome, Edge).
        </p>
      )}
      <div style={{ padding: "4px 8px 12px", flex: 1, overflow: "auto" }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, paddingLeft: 4 }}>{projectLabel}</div>
        {!hasRoot && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--color-neutral)", lineHeight: 1.45 }}>
            Open a project folder to browse and edit files. Then paste that folder’s full disk path in the bar above the
            terminal so commands run in the right place.
          </p>
        )}
        {hasRoot && rootEntries && (
          <div role="tree">
            <Row
              depth={0}
              name={projectLabel}
              isDir
              expanded={expanded.has("")}
              selected={false}
              onClick={() => void toggleExpand("", async () => onEnsureLoaded(""))}
            />
            {expanded.has("") && (
              <TreeLevel
                parentPath=""
                depth={1}
                entries={rootEntries}
                cache={cache}
                expanded={expanded}
                toggle={toggleExpand}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                onEnsureLoaded={onEnsureLoaded}
              />
            )}
          </div>
        )}
        {hasRoot && !rootEntries && <p style={{ color: "var(--color-neutral)", fontSize: 12 }}>Loading…</p>}
      </div>
    </aside>
  );
}

const btnPrimary: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "none",
  background: "var(--color-ai-primary)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600
};

const btnNeutral: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid var(--ide-border)",
  background: "var(--ide-bg-hover)",
  color: "var(--ide-fg)",
  cursor: "pointer",
  fontSize: 12
};

const btnDanger: CSSProperties = {
  ...btnNeutral,
  borderColor: "var(--color-error)",
  color: "var(--color-error)"
};
