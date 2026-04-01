export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
}

export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  tool: string;
  output: string;
}

export interface AgentTurnContext {
  userPrompt: string;
  cwd: string;
  maxSteps: number;
}
