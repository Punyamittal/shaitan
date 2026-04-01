import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { Tool } from "../types";

const FileWriteSchema = z.object({
  path: z.string().min(1),
  content: z.string()
});

export class FileWriteTool implements Tool<typeof FileWriteSchema> {
  name = "FileWriteTool";
  description = "Create or overwrite a file.";
  inputSchema = FileWriteSchema;

  async execute(input: z.infer<typeof FileWriteSchema>, ctx: { cwd: string }): Promise<string> {
    const path = resolve(ctx.cwd, input.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.content, "utf8");
    return `Wrote ${input.path}`;
  }
}
