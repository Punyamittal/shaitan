import { access, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { OllamaClient } from "@local-ai-ide/ollama-client";

export interface FileCandidate {
  path: string;
  summary: string;
}

export interface FileSection {
  path: string;
  startLine: number;
  endLine: number;
}

export class VectorlessSelector {
  constructor(private readonly ollama: OllamaClient, private readonly model: string) {}

  async buildContext(
    userPrompt: string,
    cwd: string,
    candidates: FileCandidate[]
  ): Promise<string> {
    if (!candidates.length) {
      return "Vectorless context: none (no candidate files in workspace).";
    }
    const selectedFiles = await this.selectFiles(userPrompt, candidates);
    const fileSections = await this.selectSections(userPrompt, cwd, selectedFiles);
    const chunks: string[] = [];

    for (const section of fileSections) {
      try {
        const abs = resolve(cwd, section.path);
        const content = await readFile(abs, "utf8");
        const lines = content.split("\n").slice(section.startLine - 1, section.endLine);
        chunks.push(`FILE: ${section.path}:${section.startLine}-${section.endLine}\n${lines.join("\n")}`);
      } catch {
        // Model may reference a path that does not exist or is out of range.
      }
    }

    return chunks.length ? `Vectorless context:\n\n${chunks.join("\n\n")}` : "Vectorless context: none";
  }

  async selectFiles(prompt: string, candidates: FileCandidate[]): Promise<string[]> {
    if (!candidates.length) return [];
    try {
      const response = await this.ollama.chat({
        model: this.model,
        format: "json",
        messages: [
          {
            role: "system",
            content:
              'Pick relevant file paths only. Return JSON as {"files":["..."]}. Do not include anything else.'
          },
          {
            role: "user",
            content: `Question: ${prompt}\n\nCandidates:\n${JSON.stringify(candidates)}`
          }
        ]
      });
      const parsed = JSON.parse(response) as { files?: string[] };
      return parsed.files ?? [];
    } catch {
      return [];
    }
  }

  async selectSections(prompt: string, cwd: string, files: string[]): Promise<FileSection[]> {
    if (!files.length) return [];
    const previews: Array<{ path: string; preview: string }> = [];
    for (const file of files.slice(0, 12)) {
      try {
        const abs = resolve(cwd, file);
        await access(abs);
        const raw = await readFile(abs, "utf8");
        previews.push({ path: relative(cwd, abs), preview: raw.slice(0, 4000) });
      } catch {
        // Skip missing or unreadable paths the model returned.
      }
    }
    if (!previews.length) return [];
    try {
      const response = await this.ollama.chat({
        model: this.model,
        format: "json",
        messages: [
          {
            role: "system",
            content:
              'Pick relevant ranges and return JSON {"sections":[{"path":"...","startLine":1,"endLine":40}]}.'
          },
          {
            role: "user",
            content: `Question: ${prompt}\n\nFile previews:\n${JSON.stringify(previews)}`
          }
        ]
      });
      const parsed = JSON.parse(response) as { sections?: FileSection[] };
      return parsed.sections ?? [];
    } catch {
      return [];
    }
  }
}
