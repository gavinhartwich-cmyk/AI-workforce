import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import { ModelRouter } from "../src/runtime/model-router.js";
import { FakeModelProvider } from "../src/runtime/model-providers/fake.js";
import { ToolRegistry } from "../src/runtime/tool-registry.js";
import { DefaultPolicyEngine } from "../src/runtime/policy-engine.js";
import { InMemoryAuditSink } from "../src/runtime/audit-sink.js";
import { createGetCompanyTool } from "../src/tools/get-company.js";
import { companyReviewAgent } from "../src/agents/company-review-agent.js";
import type { AgentDefinition, ToolDefinition } from "../src/runtime/types.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

function buildRuntime(opts: {
  structuredResponse: unknown;
  tools?: ToolDefinition[];
  rules?: { tool: string; minAutonomyLevel: number }[];
  audit?: InMemoryAuditSink;
}) {
  const audit = opts.audit ?? new InMemoryAuditSink();
  const registry = new ToolRegistry();
  for (const tool of opts.tools ?? []) registry.register(tool);

  const provider = new FakeModelProvider({ structuredResponse: opts.structuredResponse });
  const runtime = new AgentRuntime({
    modelRouter: new ModelRouter({ fast: provider, strong: provider }),
    tools: registry,
    policy: new DefaultPolicyEngine(opts.rules ?? []),
    audit,
  });
  return { runtime, audit };
}

describe("AgentRuntime — happy path", () => {
  it("runs input → reason → structured output → tool call → audit end to end", async () => {
    const getCompanyTool = createGetCompanyTool(async (id) => ({
      id,
      name: "Example HVAC Co.",
      website: null,
      city: "Winnipeg",
      state: "MB",
      googleReviewCount: 3,
      googleRating: "3.20",
      qualificationScore: null,
      qualificationReasoning: null,
      status: "needs_review",
    }));

    const { runtime, audit } = buildRuntime({
      tools: [getCompanyTool],
      structuredResponse: {
        assessment: "Low review count — worth a human look.",
        needsCompanyRecord: true,
        toolCalls: [{ tool: "get_company", input: { companyId: COMPANY_ID } }],
      },
    });

    const result = await runtime.run(companyReviewAgent, {
      companyId: COMPANY_ID,
      reason: "Only 3 Google reviews.",
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("unreachable");
    expect(result.output.needsCompanyRecord).toBe(true);

    expect(audit.records).toHaveLength(1);
    expect(audit.records[0].status).toBe("succeeded");
    expect(audit.records[0].toolCalls).toHaveLength(1);
    expect(audit.records[0].toolCalls[0].tool).toBe("get_company");
    expect(audit.records[0].runId).toBe(result.runId);
  });
});

describe("AgentRuntime — input validation", () => {
  it("fails closed on invalid input without calling the model", async () => {
    const { runtime, audit } = buildRuntime({ structuredResponse: {} });

    // Missing required `reason` field.
    const result = await runtime.run(companyReviewAgent, { companyId: COMPANY_ID } as never);

    expect(result.status).toBe("failed");
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0].status).toBe("failed");
    expect(audit.records[0].model).toBe("n/a"); // never reached the model
  });
});

describe("AgentRuntime — undeclared tool calls", () => {
  it("fails when the model's output requests a tool the agent didn't declare", async () => {
    // companyReviewAgent's own schema only allows tool: "get_company", so
    // exercising the undeclared-tool path needs a more permissive test
    // agent whose schema accepts any tool name.
    const permissiveAgent: AgentDefinition<{ x: string }, { toolCalls: { tool: string; input: unknown }[] }> = {
      id: "permissive_test_agent",
      name: "Permissive Test Agent",
      version: "0.1.0",
      capabilities: [],
      tools: [], // declares NO tools
      inputSchema: z.object({ x: z.string() }),
      outputSchema: z.object({
        toolCalls: z.array(z.object({ tool: z.string(), input: z.unknown() })),
      }),
      autonomyLevel: 5,
      modelLane: "fast",
      buildPrompt: () => ({ system: "s", user: "u", jsonSchema: {} }),
    };

    const { runtime, audit } = buildRuntime({
      structuredResponse: { toolCalls: [{ tool: "undeclared_tool", input: {} }] },
    });

    const result = await runtime.run(permissiveAgent, { x: "hi" });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.error).toMatch(/isn't in its declared tool list/);
    expect(audit.records[0].status).toBe("failed");
  });
});

describe("AgentRuntime — policy enforcement", () => {
  it("denies a mutating tool call with no policy rule covering it", async () => {
    const mutatingTool: ToolDefinition<{ note: string }, { ok: true }> = {
      name: "send_email",
      description: "test mutating tool",
      mutating: true,
      inputSchema: z.object({ note: z.string() }),
      execute: async () => ({ ok: true }),
    };

    const agent: AgentDefinition<{ x: string }, { toolCalls: { tool: string; input: unknown }[] }> = {
      id: "mutating_test_agent",
      name: "Mutating Test Agent",
      version: "0.1.0",
      capabilities: [],
      tools: ["send_email"],
      inputSchema: z.object({ x: z.string() }),
      outputSchema: z.object({
        toolCalls: z.array(z.object({ tool: z.string(), input: z.unknown() })),
      }),
      autonomyLevel: 0, // observe only
      modelLane: "fast",
      buildPrompt: () => ({ system: "s", user: "u", jsonSchema: {} }),
    };

    const { runtime, audit } = buildRuntime({
      tools: [mutatingTool],
      rules: [], // no rule covers send_email — fail closed
      structuredResponse: { toolCalls: [{ tool: "send_email", input: { note: "hi" } }] },
    });

    const result = await runtime.run(agent, { x: "hi" });

    expect(result.status).toBe("denied");
    expect(audit.records[0].status).toBe("denied");
  });

  it("allows a mutating tool call once a rule covers the agent's autonomy level", async () => {
    const mutatingTool: ToolDefinition<{ note: string }, { ok: true }> = {
      name: "send_email",
      description: "test mutating tool",
      mutating: true,
      inputSchema: z.object({ note: z.string() }),
      execute: async () => ({ ok: true }),
    };

    const agent: AgentDefinition<{ x: string }, { toolCalls: { tool: string; input: unknown }[] }> = {
      id: "mutating_test_agent_2",
      name: "Mutating Test Agent 2",
      version: "0.1.0",
      capabilities: [],
      tools: ["send_email"],
      inputSchema: z.object({ x: z.string() }),
      outputSchema: z.object({
        toolCalls: z.array(z.object({ tool: z.string(), input: z.unknown() })),
      }),
      autonomyLevel: 3,
      modelLane: "fast",
      buildPrompt: () => ({ system: "s", user: "u", jsonSchema: {} }),
    };

    const { runtime, audit } = buildRuntime({
      tools: [mutatingTool],
      rules: [{ tool: "send_email", minAutonomyLevel: 3 }],
      structuredResponse: { toolCalls: [{ tool: "send_email", input: { note: "hi" } }] },
    });

    const result = await runtime.run(agent, { x: "hi" });

    expect(result.status).toBe("succeeded");
    expect(audit.records[0].status).toBe("succeeded");
    expect(audit.records[0].toolCalls[0].output).toEqual({ ok: true });
  });
});
