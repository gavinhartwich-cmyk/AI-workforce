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

## Phase 1 status — done

Per `SPEC.md` §55, Phase 1 is: agent runtime, tool registry, model
abstraction, permissions, policy engine, audit system, structured output
validation. **No autonomous outbound messaging.** `src/agents/company-review-agent.ts`
is the proof-of-pipeline agent (input → reason → structured output →
policy-checked tool call → audit), matching the spec's Phase 1 definition
of done.

Known, deliberate Phase 1 limitation: the runtime is a single reasoning
pass. A tool call an agent's output requests executes and gets audited,
but its result isn't fed back for a further, better-informed answer.
Phase 2 doesn't need that loop either — see below — but a later phase
eventually will.

## Phase 2 status — done

Discovery → Research → Qualification, wired to real hartwich-os data
(`SPEC.md` §55 Phase 2):

- **`src/agents/prospect-discovery-agent.ts`** — screens raw Google Places
  results for obvious mismatches (fast lane). Search and dedupe themselves
  are deterministic code, not model calls (`src/tools/search-google-places.ts`,
  `find-duplicate-company.ts`) — SPEC.md §10's "don't use an LLM for what
  code does reliably."
- **`src/agents/research-agent.ts`** — turns Places data + fetched website
  text (`src/tools/fetch-website-text.ts`) into structured business/contact/
  evidence-based sales-signal intelligence (fast lane).
- **`src/agents/qualification-agent.ts`** — scores six dimensions 0-100
  with reasoning; it never computes a final number. `src/qualification/scoring.ts`
  is the deterministic weighted formula (ICP fit 30% / Opportunity 25% /
  Contactability 15% / Business Quality 15% / Timing 10% / Data Confidence
  5%, per SPEC.md §25) that turns those into a score, tier (A+…D), and
  status (qualified/needs_review/disqualified) — pure, unit-tested, and
  never touched by the model.
- **`src/pipelines/discover-research-qualify.ts`** — wires all of the
  above together, plus the one mutating step: `persist_discovered_company`
  (`src/tools/persist-discovered-company.ts` / `src/db/hartwich-os/write-store.ts`),
  which mirrors hartwich-os's own `createDiscoveredCompany` field-for-field
  (always writes the company row so a re-run's dedupe check skips it;
  creates a contact only if one was found; creates a deal, into the
  lowest-position pipeline stage, only when status is "qualified"). This
  write is routine/autonomous per SPEC.md §17 — see
  `src/policy/default-rules.ts` for the policy rule that allows it at
  `AUTONOMOUS_ROUTINE` (no per-lead approval).

`npm run demo:discover` runs the whole pipeline against fixtures — no
`GOOGLE_PLACES_API_KEY` or `HARTWICH_DATABASE_URL` needed. Point both at
real credentials (see `.env.example`) to run it against live Google Places
and a real hartwich-os database.

## Phase 3 status — done

Goal Engine, KPI Engine, Forecasting, Bottleneck Detection (`SPEC.md` §55
Phase 3) — the system can now answer "are we on track to hit our sales
goal?" End to end in `src/goals/goal-status-report.ts`:

- **`src/goals/goal-store.ts`** — `sales_goals` CRUD (this repo's own
  database). A goal is `{ metric, target, periodStart, periodEnd,
  priority, constraints, status }` per `SPEC.md` §49.
- **`src/goals/kpi-engine.ts`** — deterministic, code-only per-metric
  computation (`SPEC.md` §10: "don't let an LLM do arithmetic plain code
  handles"), reading real hartwich-os data
  (`src/db/hartwich-os/funnel-reader.ts`) and this repo's own agent health
  (`src/db/agent-health-reader.ts`, computed live from `agent_runs` —
  Phase 1/2 already populate it). Metrics with no data source yet
  (`positive_conversations`, `outreach_sent`, ...) honestly return `value:
  null, confidence: 0` rather than a fabricated zero — they land with
  Phase 4-6.
- **`src/goals/pace-forecast.ts`** — pure functions: `computePace`
  (expected-by-now, variance, required future pace, `SPEC.md` §12) and
  `computeForecast` (projected final value, a documented probability
  heuristic, and a `NOT_STARTED/ON_TRACK/AT_RISK/BEHIND/CRITICAL/ACHIEVED`
  status, `SPEC.md` §11).
- **`src/goals/bottleneck-engine.ts`** — ranks every funnel-stage
  conversion by *impact on the final stage* if it alone matched its
  (configurable, `SPEC.md` §9) target rate, holding every other stage's
  actual performance fixed — falling back to a stage's own target rate
  when its actual rate is undefined (nothing has reached it yet), so a
  single data gap doesn't kill every downstream impact estimate.
  `SPEC.md` §14: diagnose before increasing every agent's workload.
- **`src/goals/manager-decision-store.ts`** — `manager_decisions`
  (`SPEC.md` §36's `ManagerDecision` shape). Phase 3 writes one
  diagnosis-only record per report (`selectedAction: "none"` — there's no
  autonomous decision-maker to choose and execute an intervention until
  Phase 9's Sales Manager exists). The table's shape is final now so
  Phase 9 only changes how it's used, not its structure.

`npm run demo:goal-status` prints a full status report — goal, current
KPI, pace, forecast, bottleneck diagnosis — against fixtures, no database
needed.

## Phase 4 status — done

Outreach Strategy, Outreach Generation, an approved-messaging system, and
an experiment engine (`SPEC.md` §55 Phase 4). **Still no sending** — Phase
5 is what's allowed to execute; this phase only drafts.

- **`src/outreach/approved-messaging-config.ts`** — the boundary every
  outreach agent operates inside (offer, positioning, enabled channels,
  hard rules against fabrication, follow-up cap, CTA/word-count limits),
  as data (`SPEC.md` §20) — tightening a rule is a config edit, not a
  prompt hunt across agent files.
- **`src/agents/outreach-strategy-agent.ts`** — decides channel, angle,
  hook, personalization points, and CTA for one prospect, separately from
  wording (`SPEC.md` §26). This is new versus hartwich-os's own
  `draft-outreach.ts`, which bakes strategy and copy into a single prompt.
- **`src/agents/outreach-generation-agent.ts`** — turns a strategy
  decision into the initial message plus up to `maxFollowUps` short
  bump-ups (`SPEC.md` §27), constrained by the approved-messaging config's
  hard rules.
- **`src/experiments/`** — `assignment.ts` deterministically assigns a
  prospect to a variant (a hash of `experimentId:prospectId`, so there's
  no assignment table to maintain), `sample-size.ts` gates any conclusion
  until every variant has enough samples (`SPEC.md` §34: never decide from
  a tiny sample), `experiment-store.ts` is `experiments`/
  `experiment_variants` CRUD. Scoped to "define and assign" only —
  measuring real outcomes per variant needs sent-message data that lands
  with Phase 5/8.
- **`src/pipelines/strategize-and-draft-outreach.ts`** — Strategy →
  Generation → one pending-review draft, written into hartwich-os's
  *existing* `email_drafts` approval queue (its own `PHASE_3.md`) rather
  than a second inbox — Gavin already has a review UI for this today. A
  prospect with no contact email is skipped (`no_contact`), not drafted to
  nobody. Only the initial message is persisted; the generated follow-ups
  stay in this run's audit record for Phase 5 to draw on once there's a
  real sent message to attach them to.

`npm run demo:outreach` runs Strategy → Generation → draft against a
fixture, including an experiment directive actually reaching the Strategy
Agent's prompt — no database needed.

## Running it

```bash
npm install
cp .env.example .env.local   # optional for the demo/tests — see below

npm run typecheck
npm test                      # no network, no credentials needed
npm run demo:company-lookup   # Phase 1 demo — runs end-to-end against a fixture
npm run demo:discover         # Phase 2 demo — full discovery/research/qualification pipeline against fixtures
npm run demo:goal-status      # Phase 3 demo — goal/KPI/pace/forecast/bottleneck report against fixtures
npm run demo:outreach         # Phase 4 demo — strategy -> generation -> draft against a fixture
```

Both demos use real Groq/Anthropic calls only if their API keys are set,
otherwise they fall back to canned `FakeModelProvider` responses.

`npm run db:generate` / `npm run db:migrate` (Drizzle) apply **this
repo's own** schema (`src/db/schema.ts`) to `AGENT_DATABASE_URL` — never
`hartwich-os`'s database.

## What's next

Per `SPEC.md` §55: Phase 5 — Outreach Execution and Follow-Up, with
autonomous operation inside the policies Phase 4 defined. This is where
hartwich-os's own Gmail sending, warm-up ramp, and rate limits actually
get wired into this repo's tool layer, and where "Workforce Capacity"
(agent queue depth, concurrency limits) starts to mean something — there's
no task queue for it to describe until agents run concurrently against
real volume.
