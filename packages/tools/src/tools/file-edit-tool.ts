import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { Tool } from "../types";

const FileEditSchema = z.object({
  path: z.string().min(1),
  search: z.string(),
  replace: z.string()
});

export class FileEditTool implements Tool<typeof FileEditSchema> {
  name = "FileEditTool";
  description = "Edit a file using exact string replacement.";
  inputSchema = FileEditSchema;

  async execute(input: z.infer<typeof FileEditSchema>, ctx: { cwd: string }): Promise<string> {
    const path = resolve(ctx.cwd, input.path);
    const current = await readFile(path, "utf8");
    if (!current.includes(input.search)) {
      throw new Error(`Search string not found in ${input.path}`);
    }
    const next = current.replace(input.search, input.replace);
    await writeFile(path, next, "utf8");
    return `Edited ${input.path}`;
  }
}
