import type { Tool } from "./types";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
