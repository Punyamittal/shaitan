import { NextResponse } from "next/server";

function ollamaBase(): string {
  const raw = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
  return raw.replace(/\/$/, "");
}

/**
 * Lists tags from the local Ollama daemon for the model dropdown.
 */
export async function GET() {
  try {
    const res = await fetch(`${ollamaBase()}/api/tags`, {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json(
        {
          models: [] as string[],
          error: `Ollama ${res.status}: ${t.slice(0, 200)}`
        },
        { status: 200 }
      );
    }
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ models });
  } catch (e) {
    return NextResponse.json({
      models: [] as string[],
      error: e instanceof Error ? e.message : "Failed to reach Ollama"
    });
  }
}
