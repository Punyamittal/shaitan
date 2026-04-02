"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentConversation, AgentMode, AiStatusPhase } from "../components/AIPanel";
import { AIPanel } from "../components/AIPanel";
import { EditorPanel } from "../components/EditorPanel";
import { FileExplorerPanel } from "../components/FileExplorerPanel";
import { TerminalPanel } from "../components/TerminalPanel";
import {
  createEmptyFile,
  deleteEntry,
  hasDirectoryPicker,
  listChildren,
  pickProjectDirectory,
  readTextFile,
  writeTextFile
} from "../lib/client-fs";

function extractCodeBlock(text: string): string | null {
  const m = /```(?:[\w+-]+)?\s*([\s\S]*?)```/.exec(text);
  return m ? m[1].trim() : null;
}

function createConversation(): AgentConversation {
  const id = crypto.randomUUID();
  return {
    id,
    title: "New chat",
    messages: [],
    draft: "",
    mode: "auto",
    lastRun: null
  };
}

function titleFromPrompt(p: string): string {
  const t = p.replace(/\s+/g, " ").trim();
  if (!t) return "New chat";
  return t.length > 28 ? `${t.slice(0, 28)}…` : t;
}

export default function HomePage() {
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [projectLabel, setProjectLabel] = useState("No project");
  const [cache, setCache] = useState<Record<string, import("../lib/client-fs").DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const [activePath, setActivePath] = useState("");
  const [fileBodies, setFileBodies] = useState<Record<string, string>>({});

  const initialConversation = useMemo(() => createConversation(), []);
  const [conversations, setConversations] = useState<AgentConversation[]>(() => [initialConversation]);
  const [activeConversationId, setActiveConversationId] = useState(initialConversation.id);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [modelsLoadError, setModelsLoadError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");

  const [running, setRunning] = useState(false);
  const [statusPhase, setStatusPhase] = useState<AiStatusPhase>("idle");
  const [toast, setToast] = useState<string | null>(null);
  /** Must not read `window` during SSR/first paint or server HTML ≠ client (React #418). */
  const [pickerSupported, setPickerSupported] = useState(false);
  useEffect(() => {
    setPickerSupported(hasDirectoryPicker());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ollama/models");
        const j = (await res.json()) as { models?: string[]; error?: string };
        if (cancelled) return;
        setOllamaModels(j.models ?? []);
        setModelsLoadError(j.error ?? null);
        setSelectedModel((cur) => {
          if (cur) return cur;
          return j.models?.[0] ?? "qwen3:4b";
        });
      } catch (e) {
        if (!cancelled) {
          setModelsLoadError(e instanceof Error ? e.message : "Failed to load models");
          setSelectedModel((c) => c || "qwen3:4b");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Same absolute path POSTed to /api/workspace — required for PTY cwd (picker does not expose disk path). */
  const [serverWorkspaceRoot, setServerWorkspaceRoot] = useState<string | null>(null);
  const [serverPathDraft, setServerPathDraft] = useState("");
  const [serverPathError, setServerPathError] = useState<string | null>(null);
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/workspace", { credentials: "include" });
        const j = (await res.json()) as { root?: string | null };
        if (cancelled || !j.root) return;
        setServerWorkspaceRoot(j.root);
        setServerPathDraft(j.root);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyServerPath = useCallback(async () => {
    const raw = serverPathDraft.trim().replace(/^["']+|["']+$/g, "");
    if (!raw) {
      setServerPathError("Enter the full path to the folder you opened (e.g. C:\\Users\\you\\repo).");
      return;
    }
    setServerPathError(null);
    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ path: raw })
      });
      const data = (await res.json()) as { root?: string; error?: string };
      if (!res.ok) {
        setServerPathError(data.error ?? res.statusText);
        return;
      }
      if (data.root) {
        setServerWorkspaceRoot(data.root);
        setServerPathDraft(data.root);
      }
    } catch (e) {
      setServerPathError(e instanceof Error ? e.message : "Request failed");
    }
  }, [serverPathDraft]);

  const abortRef = useRef<AbortController | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileBodiesRef = useRef(fileBodies);
  fileBodiesRef.current = fileBodies;

  const rootEntries = cache[""];

  const loadFolder = useCallback(
    async (rel: string) => {
      if (!rootHandle) return;
      const children = await listChildren(rootHandle, rel);
      setCache((c) => ({ ...c, [rel]: children }));
    },
    [rootHandle]
  );

  const onEnsureLoaded = useCallback(
    async (rel: string) => {
      if (cache[rel]) return;
      await loadFolder(rel);
    },
    [cache, loadFolder]
  );

  const toggleExpand = useCallback((folderPath: string, before: () => Promise<void>) => {
    void (async () => {
      const willOpen = !expandedRef.current.has(folderPath);
      if (willOpen) await before();
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(folderPath)) next.delete(folderPath);
        else next.add(folderPath);
        return next;
      });
    })();
  }, []);

  const onOpenProject = useCallback(async () => {
    const h = await pickProjectDirectory();
    if (!h) return;
    setServerWorkspaceRoot(null);
    setServerPathDraft("");
    setServerPathError(null);
    setWorkspaceEpoch((e) => e + 1);
    void fetch("/api/workspace", { method: "DELETE", credentials: "include" });
    setRootHandle(h);
    setProjectLabel(h.name);
    setExpanded(new Set([""]));
    setActivePath("");
    setFileBodies({});
    const children = await listChildren(h, "");
    setCache({ "": children });
  }, []);

  const onSelectFile = useCallback(
    async (path: string) => {
      if (!rootHandle) return;
      setActivePath(path);
      if (fileBodiesRef.current[path] !== undefined) return;
      try {
        const text = await readTextFile(rootHandle, path);
        setFileBodies((b) => ({ ...b, [path]: text }));
      } catch (e) {
        setFileBodies((b) => ({
          ...b,
          [path]: `// ${e instanceof Error ? e.message : "Read failed"}\n`
        }));
      }
    },
    [rootHandle]
  );

  const onSave = useCallback(async () => {
    if (!rootHandle || !activePath) return;
    try {
      await writeTextFile(rootHandle, activePath, fileBodies[activePath] ?? "");
      setToast("Saved");
      setTimeout(() => setToast(null), 2000);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Save failed");
      setTimeout(() => setToast(null), 4000);
    }
  }, [rootHandle, activePath, fileBodies]);

  const onNewFile = useCallback(async () => {
    if (!rootHandle) return;
    const name = window.prompt("New file name", "untitled.txt");
    if (!name?.trim()) return;
    const safe = name.trim().replace(/[/\\]/g, "_");
    try {
      await createEmptyFile(rootHandle, safe);
      await loadFolder("");
      setActivePath(safe);
      setFileBodies((b) => ({ ...b, [safe]: "" }));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not create file");
    }
  }, [rootHandle, loadFolder]);

  const onDelete = useCallback(async () => {
    if (!rootHandle || !activePath) return;
    if (!window.confirm(`Delete ${activePath}?`)) return;
    try {
      await deleteEntry(rootHandle, activePath);
      setFileBodies((b) => {
        const n = { ...b };
        delete n[activePath];
        return n;
      });
      setActivePath("");
      setCache({});
      await loadFolder("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }, [rootHandle, activePath, loadFolder]);

  const onRefreshTree = useCallback(async () => {
    if (!rootHandle) return;
    setCache({});
    const children = await listChildren(rootHandle, "");
    setCache({ "": children });
  }, [rootHandle]);

  const runAgent = useCallback(
    async (
      convId: string,
      p: string,
      m: AgentMode,
      model: string,
      signalOverride?: AbortSignal,
      opts?: { retry?: boolean }
    ) => {
      const files = Object.entries(fileBodiesRef.current).map(([path, content]) => ({ path, content }));
      const signal = signalOverride ?? abortRef.current?.signal;

      const logs: string[] = [];
      const pushLog = (line: string) => {
        logs.push(line);
      };

      const isRetry = Boolean(opts?.retry);
      if (!isRetry) {
        const userMsgId = crypto.randomUUID();
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  title: c.messages.length === 0 ? titleFromPrompt(p) : c.title,
                  messages: [...c.messages, { id: userMsgId, role: "user" as const, content: p }],
                  draft: "",
                  lastRun: { prompt: p, mode: m }
                }
              : c
          )
        );
      } else {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId ? { ...c, lastRun: { prompt: p, mode: m } } : c
          )
        );
      }

      setRunning(true);
      setStatusPhase("thinking");
      pushLog("✔ Request started");
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = setTimeout(() => setStatusPhase("planning"), 400);
      const t2 = setTimeout(() => setStatusPhase("executing"), 900);

      try {
        const res = await fetch("/agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ prompt: p, mode: m, files, model }),
          ...(signal ? { signal } : {})
        });
        clearTimeout(t2);
        const data = (await res.json()) as { finalText?: string; error?: string };
        const text = data.finalText ?? data.error ?? JSON.stringify(data);
        const assistantId = crypto.randomUUID();
        if (!res.ok) {
          pushLog(`✖ Error: ${text}`);
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: [
                      ...c.messages,
                      {
                        id: assistantId,
                        role: "assistant",
                        content: text,
                        logs: [...logs],
                        error: true
                      }
                    ]
                  }
                : c
            )
          );
        } else {
          pushLog("✔ Agent finished");
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: [
                      ...c.messages,
                      { id: assistantId, role: "assistant", content: text, logs: [...logs] }
                    ]
                  }
                : c
            )
          );
        }
        setStatusPhase("done");
      } catch (e) {
        clearTimeout(t2);
        if ((e as Error).name === "AbortError") {
          pushLog("✖ Stopped");
          setStatusPhase("idle");
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: [
                      ...c.messages,
                      {
                        id: crypto.randomUUID(),
                        role: "assistant",
                        content: "Run stopped.",
                        logs: [...logs]
                      }
                    ]
                  }
                : c
            )
          );
        } else {
          const msg = e instanceof Error ? e.message : "Failed";
          pushLog(`✖ ${msg}`);
          setStatusPhase("idle");
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: [
                      ...c.messages,
                      {
                        id: crypto.randomUUID(),
                        role: "assistant",
                        content: msg,
                        logs: [...logs],
                        error: true
                      }
                    ]
                  }
                : c
            )
          );
        }
      } finally {
        setRunning(false);
        if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
      }
    },
    []
  );

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ?? conversations[0];

  const lastAssistant =
    [...(activeConversation?.messages ?? [])]
      .reverse()
      .find((m) => m.role === "assistant")?.content ?? "";

  const onRun = useCallback(async () => {
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv) return;
    const p = conv.draft.trim();
    if (!p) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    await runAgent(activeConversationId, p, conv.mode, selectedModel, abortRef.current.signal);
  }, [conversations, activeConversationId, selectedModel, runAgent]);

  const onStop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    setStatusPhase("idle");
  }, []);

  const onRetry = useCallback(async () => {
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv || !conv.lastRun) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    await runAgent(
      activeConversationId,
      conv.lastRun.prompt,
      conv.lastRun.mode,
      selectedModel,
      abortRef.current.signal,
      { retry: true }
    );
  }, [conversations, activeConversationId, selectedModel, runAgent]);

  const onNewConversation = useCallback(() => {
    const c = createConversation();
    setConversations((p) => [...p, c]);
    setActiveConversationId(c.id);
  }, []);

  const onCloseConversation = useCallback((id: string) => {
    setConversations((p) => {
      if (p.length <= 1) return p;
      const next = p.filter((c) => c.id !== id);
      setActiveConversationId((aid) => (aid === id ? next[0]!.id : aid));
      return next;
    });
  }, []);

  const setDraftForActive = useCallback(
    (v: string) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConversationId ? { ...c, draft: v } : c))
      );
    },
    [activeConversationId]
  );

  const setModeForActive = useCallback(
    (m: AgentMode) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConversationId ? { ...c, mode: m } : c))
      );
    },
    [activeConversationId]
  );

  const canApplyAi = Boolean(lastAssistant && extractCodeBlock(lastAssistant));

  const onApplyAi = useCallback(() => {
    const block = extractCodeBlock(lastAssistant);
    if (!block || !activePath) return;
    setFileBodies((b) => ({ ...b, [activePath]: block }));
    setToast("Applied to editor (Save to write)");
    setTimeout(() => setToast(null), 2500);
  }, [lastAssistant, activePath]);

  const editorContent = activePath ? (fileBodies[activePath] ?? "") : "";
  const activeLangPath = activePath || "file.txt";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <header
        style={{
          flexShrink: 0,
          height: 40,
          display: "flex",
          alignItems: "center",
          paddingLeft: 12,
          paddingRight: 12,
          borderBottom: "1px solid var(--ide-border)",
          background: "var(--ide-bg-elevated)",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.02em",
          justifyContent: "space-between"
        }}
      >
        <span>Shaitan</span>
        {toast && (
          <span style={{ color: "var(--color-success)", fontSize: 12, fontWeight: 500 }}>{toast}</span>
        )}
      </header>

      {/* Workbench: left column (explorer | editor + terminal) + full-height agent */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "row",
          minHeight: 0,
          overflow: "hidden",
          alignItems: "stretch"
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden"
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "row",
              minHeight: 0,
              overflow: "hidden"
            }}
          >
            <FileExplorerPanel
              projectLabel={projectLabel}
              hasRoot={Boolean(rootHandle)}
              pickerSupported={pickerSupported}
              rootEntries={rootEntries ?? null}
              cache={cache}
              expanded={expanded}
              toggleExpand={toggleExpand}
              selectedPath={activePath || null}
              onSelectFile={(p) => void onSelectFile(p)}
              onEnsureLoaded={onEnsureLoaded}
              onOpenProject={onOpenProject}
              onNewFile={onNewFile}
              onDelete={onDelete}
              onRefresh={onRefreshTree}
            />

            <EditorPanel
              path={activeLangPath}
              content={editorContent}
              readOnly={!activePath}
              onChange={(v) => {
                if (!activePath) return;
                setFileBodies((b) => ({ ...b, [activePath]: v }));
              }}
              onSave={onSave}
              onApplyAi={onApplyAi}
              canApplyAi={canApplyAi && Boolean(activePath)}
            />
          </div>

          {rootHandle && (
            <div
              style={{
                flexShrink: 0,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderTop: "1px solid var(--ide-border)",
                background: "var(--ide-bg-elevated)",
                fontSize: 12
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--ide-fg)" }}>Terminal folder</span>
              <input
                type="text"
                value={serverPathDraft}
                onChange={(e) => {
                  setServerPathDraft(e.target.value);
                  setServerPathError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void applyServerPath();
                }}
                placeholder="Paste absolute path to this project (same folder as Open Project)"
                spellCheck={false}
                style={{
                  flex: "1 1 220px",
                  minWidth: 180,
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--ide-border)",
                  background: "var(--ide-bg)",
                  color: "var(--ide-fg)",
                  fontSize: 12,
                  fontFamily: "Consolas, 'Courier New', monospace"
                }}
              />
              <button
                type="button"
                onClick={() => void applyServerPath()}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "none",
                  background: "var(--color-ai-primary)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600
                }}
              >
                Apply
              </button>
              {serverPathError && (
                <span style={{ color: "var(--color-error)", flex: "1 1 100%" }}>{serverPathError}</span>
              )}
              {serverWorkspaceRoot && !serverPathError && (
                <span style={{ color: "var(--color-success)", fontSize: 11, flex: "1 1 100%" }}>
                  Shell starts in: {serverWorkspaceRoot}
                </span>
              )}
            </div>
          )}

          <TerminalPanel
            key={`${workspaceEpoch}-${serverWorkspaceRoot ?? "off"}`}
            workspaceLinked={Boolean(serverWorkspaceRoot)}
            projectOpen={Boolean(rootHandle)}
          />
        </div>

        <AIPanel
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={setActiveConversationId}
          onNewConversation={onNewConversation}
          onCloseConversation={onCloseConversation}
          onDraftChange={setDraftForActive}
          onModeChange={setModeForActive}
          models={ollamaModels}
          selectedModel={selectedModel || "qwen3:4b"}
          onModelChange={setSelectedModel}
          modelsError={modelsLoadError}
          onRun={() => void onRun()}
          onStop={onStop}
          onRetry={() => void onRetry()}
          running={running}
          statusPhase={statusPhase}
          canRetry={Boolean(activeConversation?.lastRun)}
        />
      </div>
    </div>
  );
}
