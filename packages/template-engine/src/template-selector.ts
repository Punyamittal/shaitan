import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { OllamaClient } from "@local-ai-ide/ollama-client";

export interface TemplateMeta {
  name: string;
  tags: string[];
  framework: "react";
  style: string;
  file: string;
}

export class TemplateEngine {
  constructor(
    private readonly templatesRoot: string,
    private readonly ollama: OllamaClient,
    private readonly model: string
  ) {}

  async maybePrepareTemplate(userPrompt: string): Promise<string> {
    const metas = await this.loadTemplateMetas();
    if (!metas.length) return "Template selection: no template needed.";
    const selected = await this.selectTemplates(userPrompt, metas);
    if (!selected.length) return "Template selection: no template needed.";

    const rendered: string[] = [];
    for (const meta of selected) {
      const source = await readFile(join(this.templatesRoot, meta.file), "utf8");
      const adapted = await this.adaptTemplate(userPrompt, meta, source);
      rendered.push(`// ${meta.name}\n${adapted}`);
    }
    return `Template-first UI context:\n\n${rendered.join("\n\n")}`;
  }

  private async loadTemplateMetas(): Promise<TemplateMeta[]> {
    try {
      const manifestRaw = await readFile(join(this.templatesRoot, "manifest.json"), "utf8");
      return JSON.parse(manifestRaw) as TemplateMeta[];
    } catch {
      return [];
    }
  }

  private async selectTemplates(prompt: string, metas: TemplateMeta[]): Promise<TemplateMeta[]> {
    const raw = await this.ollama.chat({
      model: this.model,
      format: "json",
      messages: [
        {
          role: "system",
          content: 'Select template names. Return JSON {"names":["..."]}.'
        },
        { role: "user", content: `Prompt: ${prompt}\n\nTemplates:\n${JSON.stringify(metas)}` }
      ]
    });
    const picked = (JSON.parse(raw) as { names?: string[] }).names ?? [];
    return metas.filter((m) => picked.includes(m.name));
  }

  private async adaptTemplate(prompt: string, meta: TemplateMeta, source: string): Promise<string> {
    return this.ollama.chat({
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "You must modify the provided template only. Keep component structure and return code only."
        },
        {
          role: "user",
          content: `User request: ${prompt}\n\nTemplate meta: ${JSON.stringify(meta)}\n\nTemplate:\n${source}`
        }
      ]
    });
  }
}
