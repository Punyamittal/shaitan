import { z } from "zod";

export interface ToolExecutionContext {
  cwd: string;
}

export interface Tool<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TInput;
  execute(input: z.infer<TInput>, ctx: ToolExecutionContext): Promise<string>;
}
