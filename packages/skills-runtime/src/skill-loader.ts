import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";

export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
}

export class SkillLoader {
  constructor(private readonly skillsDir: string) {}

  async loadAll(): Promise<SkillDefinition[]> {
    try {
      const st = await stat(this.skillsDir);
      if (!st.isDirectory()) return [];
    } catch {
      // Missing or unreadable skills dir — same as no skills (workspaces without ./skills).
      return [];
    }

    const entries = await readdir(this.skillsDir, { withFileTypes: true });
    const loaded: SkillDefinition[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(this.skillsDir, entry.name, "SKILL.md");
      try {
        const raw = await readFile(skillPath, "utf8");
        const parsed = matter(raw);
        loaded.push({
          name: String(parsed.data.name ?? entry.name),
          description: String(parsed.data.description ?? ""),
          instructions: parsed.content.trim()
        });
      } catch {
        // Skip malformed or missing skills to keep runtime resilient.
      }
    }

    return loaded;
  }

  async buildSkillPrompt(userPrompt: string): Promise<string> {
    const skills = await this.loadAll();
    const active = skills.filter((s) => this.matchPrompt(s, userPrompt));
    if (!active.length) return "No skill matched this request.";
    return [
      "Active skills:",
      ...active.map((s) => `- ${s.name}: ${s.description}\n${s.instructions}`)
    ].join("\n\n");
  }

  private matchPrompt(skill: SkillDefinition, prompt: string): boolean {
    const haystack = `${skill.name} ${skill.description}`.toLowerCase();
    return prompt
      .toLowerCase()
      .split(/\W+/)
      .filter(Boolean)
      .some((token) => haystack.includes(token));
  }
}
