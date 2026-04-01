import { spawn } from "node:child_process";
import { z } from "zod";
import type { Tool } from "../types";

const BashSchema = z.object({
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().default(120000)
});

export class BashTool implements Tool<typeof BashSchema> {
  name = "BashTool";
  description =
    "Run shell commands in the workspace cwd (uses the system shell: cmd/PowerShell on Windows, sh on Unix).";
  inputSchema = BashSchema;

  async execute(input: z.infer<typeof BashSchema>, ctx: { cwd: string }): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(input.command, {
        cwd: ctx.cwd,
        shell: true
      });
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${input.timeoutMs}ms`));
      }, input.timeoutMs);
      let out = "";
      let err = "";
      proc.stdout.on("data", (d) => (out += d.toString()));
      proc.stderr.on("data", (d) => (err += d.toString()));
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out.trim() || "OK");
        else reject(new Error(err || `Command failed: ${code}`));
      });
    });
  }
}
