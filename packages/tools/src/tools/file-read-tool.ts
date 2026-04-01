import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { Tool } from "../types";

export class FileReadTool implements Tool<typeof FileReadSchema> {
  name = "FileReadTool";
  description = "Read file content from workspace.";
  inputSchema = FileReadSchema;

  async execute(input: z.infer<typeof FileReadSchema>, ctx: { cwd: string }): Promise<string> {
    const path = resolve(ctx.cwd, input.path);
    return readFile(path, "utf8");
  }
}

const FileReadSchema = z.object({
  path: z.string().min(1)
});
