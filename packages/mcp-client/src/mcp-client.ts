import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export class McpClientRegistry {
  private readonly clients = new Map<string, Client>();

  async connect(server: McpServerConfig): Promise<void> {
    const client = new Client({ name: "local-ai-ide", version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      env: server.env
    });
    await client.connect(transport);
    this.clients.set(server.name, client);
  }

  async listTools(server: string): Promise<string[]> {
    const client = this.require(server);
    const result = await client.listTools();
    return result.tools.map((t) => t.name);
  }

  async call(qualifiedTool: string, input: Record<string, unknown>): Promise<string> {
    const [server, ...parts] = qualifiedTool.split(".");
    const toolName = parts.join(".");
    if (!server || !toolName) throw new Error("Tool format must be server.tool");
    const client = this.require(server);
    const result = await client.callTool({ name: toolName, arguments: input });
    return JSON.stringify(result.content ?? result, null, 2);
  }

  private require(name: string): Client {
    const c = this.clients.get(name);
    if (!c) throw new Error(`MCP server not connected: ${name}`);
    return c;
  }
}
