# Hartwich AI Workforce

The agent runtime and (in later phases) the Sales Manager for Hartwich
Labs' AI sales workforce — see [`SPEC.md`](./SPEC.md) for the full build
spec and [`GAP_ANALYSIS.md`](./GAP_ANALYSIS.md) for how this maps onto the
existing `hartwich-os` product.

## Architecture

This is a **separate repo/service from `hartwich-os`**, confirmed by
Gavin. `hartwich-os` remains the CRM system of record — this repo never
defines its own `companies`/`contacts`/`deals`/etc. tables.

```
Agents (this repo)
      │
      ├─ own database (AGENT_DATABASE_URL) — agent_runs, agent_permissions,
      │  and later sales_goals/manager_decisions/... (spec §48)
      │
      └─ tool layer → hartwich-os's database (HARTWICH_DATABASE_URL),
         through a narrow, explicitly-mirrored schema subset
         (src/db/hartwich-os/) — read today, scoped writes in later phases
```

Two separate Postgres connections, on purpose: this repo's own
operational state (agent runs, permissions, goals, decisions) shouldn't be
migrated by `hartwich-os`'s own Drizzle config, and `hartwich-os`'s CRM
schema shouldn't be migrated by this repo's.

## Runtime pipeline (spec §41)

Every agent runs through one path — no agent re-implements any of this:

```
AgentDefinition → Context Builder → Model Router → LLM → Structured Output
→ Schema Validation → Policy Check → Tool Execution → Verification → Audit
```

- **`src/runtime/types.ts`** — the interfaces everything else implements
  (`AgentDefinition`, `ModelProvider`, `ToolDefinition`, `PolicyEngine`,
  `AuditSink`).
- **`src/runtime/model-router.ts`** + **`model-providers/{groq,anthropic,fake}.ts`**
  — the Model Router (spec §42): a "fast" lane (Groq, classification/
  extraction/routing) and a "strong" lane (Anthropic, research/strategy/
  manager decisions — unblocked for this project specifically, see
  `SPEC.md`'s header note). `fake.ts` is a deterministic no-network
  provider for tests.
- **`src/runtime/tool-registry.ts`** — where tools are registered; agents
  only ever reach a tool through this, never by constructing one themselves.
- **`src/runtime/policy-engine.ts`** — `DefaultPolicyEngine`: fail-closed,
  rule-based. Read-only tools are always allowed; a mutating tool needs an
  explicit rule covering the agent's autonomy level. This is a Phase 1
  skeleton — spec §18's fuller `AuthorityPolicy` (maxVolume/maxBudget/
  maxChangePercent) lands when Phase 5 (autonomous outreach execution)
  needs it.
- **`src/runtime/audit-sink.ts`** (in-memory, for tests) /
  **`src/db/postgres-audit-sink.ts`** (real) — every run, success or
  failure or denial, is recorded (spec §53).
- **`src/runtime/agent-runtime.ts`** — `AgentRuntime.run()`, the pipeline above.

## Phase 1 status

Per `SPEC.md` §55, Phase 1 is: agent runtime, tool registry, model
abstraction, permissions, policy engine, audit system, structured output
validation. **No autonomous outbound messaging.** That's what's in this
repo today — `src/agents/company-review-agent.ts` is the proof-of-pipeline
agent (input → reason → structured output → policy-checked tool call →
audit), matching the spec's Phase 1 definition of done.

Known, deliberate Phase 1 limitation: the runtime is a single reasoning
pass. A tool call an agent's output requests executes and gets audited,
but its result isn't fed back for a further, better-informed answer —
that "look something up, then reason again about what came back" loop is
real agentic behavior later phases (Research, Qualification) will need,
not something Phase 1 pretends to already have.

## Running it

```bash
npm install
cp .env.example .env.local   # optional for the demo/tests — see below

npm run typecheck
npm test                      # no network, no credentials needed
npm run demo:company-lookup   # runs end-to-end against a fixture; uses
                               # real Groq/Anthropic calls only if their
                               # API keys are set, otherwise falls back to
                               # a canned FakeModelProvider response
```

`npm run db:generate` / `npm run db:migrate` (Drizzle) apply **this
repo's own** schema (`src/db/schema.ts`) to `AGENT_DATABASE_URL` — never
`hartwich-os`'s database.

## What's next

Per `SPEC.md` §55: Phase 2 (Prospect Discovery / Research / Qualification,
wired to real `hartwich-os` data) once Phase 1 is reviewed.
