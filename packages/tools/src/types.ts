import { z } from "zod";

export interface ToolExecutionContext {
  cwd: string;
  /** Browser `ide-session` cookie when the agent runs from the IDE — used to reach the live PTY. */
  terminalSessionId?: string | null;
}

export interface Tool<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TInput;
  execute(input: z.infer<TInput>, ctx: ToolExecutionContext): Promise<string>;
}
