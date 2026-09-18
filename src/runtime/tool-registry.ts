import type { ToolDefinition } from "./types.js";

/**
 * Tool registry (spec §35). Agents declare tool *names* in their
 * AgentDefinition; the runtime resolves them here at execution time. This
 * indirection is what makes the policy check in agent-runtime.ts
 * unbypassable — an agent can only ever reach a tool object that this
 * registry handed to the runtime, never one it constructs itself.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }
}
