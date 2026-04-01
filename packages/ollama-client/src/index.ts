import type { ChatMessage } from "@local-ai-ide/shared-types";

export interface OllamaChatRequest {
  model: string;
  messages: ChatMessage[];
  format?: "json";
  temperature?: number;
}

function resolveDefaultBaseUrl(): string {
  if (typeof process !== "undefined" && process.env?.OLLAMA_BASE_URL?.trim()) {
    return process.env.OLLAMA_BASE_URL.trim().replace(/\/$/, "");
  }
  return "http://127.0.0.1:11434";
}

export class OllamaClient {
  private readonly baseUrl: string;

  /** @param baseUrl - Omit to use `process.env.OLLAMA_BASE_URL` or `http://127.0.0.1:11434` */
  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? resolveDefaultBaseUrl();
  }

  async chat(req: OllamaChatRequest): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        stream: false,
        format: req.format,
        options: { temperature: req.temperature ?? 0.2 },
        messages: req.messages
      })
    });
    const rawText = await res.text();
    if (!res.ok) {
      let detail = "";
      try {
        const err = JSON.parse(rawText) as { error?: string };
        if (err?.error) detail = ` — ${err.error}`;
      } catch {
        if (rawText) detail = ` — ${rawText.slice(0, 500)}`;
      }
      // Ollama uses 404 for "model not found" on /api/chat (server can still be healthy).
      const hint =
        res.status === 404
          ? ` (Model "${req.model}" is not available on this Ollama instance. Run \`ollama pull ${req.model}\` or set OLLAMA_MODEL to a tag from \`ollama list\`.)`
          : "";
      throw new Error(`Ollama chat failed: ${res.status} ${res.statusText}${detail}${hint}`);
    }
    const data = JSON.parse(rawText) as { message?: { content?: string } };
    return data.message?.content ?? "";
  }
}
