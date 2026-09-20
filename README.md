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

## Phase 5 status — done

Outreach Execution and Follow-Up (`SPEC.md` §55 Phase 5) — **autonomous
sending**, not a per-email approval queue. Per Gavin's direction
(2026-09-XX): routine outbound sends automatically once it's properly
handled, shows up where he already looks, and he can pause or suppress it
without touching code.

Phase 4's `create_email_draft`/pending-review path still exists (it's
still valid, still tested) but the primary path for routine cold outreach
and follow-ups is now this phase's autonomous execution.

**"Properly handled"** (`src/outreach/send-guard.ts`, checked before every
single send, in order):
1. **Opt-out** (`opt-out-store.ts`, this repo's own `suppressed_contacts`
   table) — permanent, no exceptions. There's no automatic
   unsubscribe-detection yet (that needs Phase 6's Conversation
   Intelligence to read a reply), but enforcement is real today for any
   entry added via `npm run outreach:control -- suppress <email>`.
2. **The kill switch** (`outreach-control-store.ts`) — a single paused/
   running row Gavin flips directly, independent of any policy rule.
3. **Sending window** (`send-window.ts`) — business hours only, not 3am.
4. **Warm-up rate limit** (`warmup.ts`, ported from hartwich-os's own
   proven ramp — 3/day ramping to 50/day, plus a 25-minute minimum
   spacing) against `email_send_accounts`, the SAME state table
   hartwich-os's own sending uses for these 3 rotating Gmail accounts
   (`email-accounts-store.ts`) — one shared cap, not two systems
   independently guessing at it.
5. **Duplicate-contact prevention** is the deal's own pipeline stage: a
   deal still in "New Lead" has never been sent to; once
   `execute-outreach.ts` sends, it moves to "Contacted" and will never be
   targeted again by that pipeline.

**Visible** (`src/db/hartwich-os/write-store.ts`'s `recordOutboundEmail`):
every autonomous send is written as a real `activities`/`messages` row —
the exact shape hartwich-os's own human-sent-email flow uses — so it
appears in hartwich-os's existing company/deal timeline. No separate
outreach log to check.

- **`src/integrations/gmail.ts`** — real Gmail API sending via the same
  3-rotating-account OAuth setup as hartwich-os's own
  `gmail-multi.ts` (reimplemented here — separate repo, same accounts).
- **`src/pipelines/execute-outreach.ts`** — cold outreach: Strategy →
  Generation (Phase 4's agents, reused) → send-guard → send → record →
  advance stage.
- **`src/agents/outreach-followup-agent.ts`** +
  **`src/pipelines/send-followups.ts`** — finds deals in "Contacted" with
  no reply, due per the same 3/6/9-day cadence as hartwich-os's own
  `cadence.ts` (`followup-cadence.ts`), generates one follow-up fresh
  (not the copy Phase 4 pre-drafted, which has nothing real to reference
  yet), sends through the same guard, and records it without moving the
  stage again.
- **`src/cli/outreach-control.ts`** (`npm run outreach:control --`) — the
  actual intervention tool: `status`, `pause "<reason>"`, `resume`,
  `suppress <email> "<reason>"`, against real `AGENT_DATABASE_URL`.

Known, deliberate Phase 5 limitation: a send failing to get *recorded*
after it already went out (network blip, DB hiccup) reports
`sent_but_not_recorded` rather than silently retrying — retrying could
double-send to the same prospect, which is worse than a bookkeeping gap
that surfaces clearly.

`npm run demo:execute-outreach` runs the full autonomous send pipeline
against fixtures — no credentials needed, and no approval step to click
through.

## Phase 6 status — done

Conversation Intelligence and the Appointment Agent (`SPEC.md` §55 Phase
6) — inbound replies get classified and handled autonomously where
that's safe, escalated where it isn't.

**These are personal 1:1 emails, not a mailing list** (Gavin,
2026-09-XX). Nothing in this repo adds unsubscribe links, list-management
footers, or any mechanism that would make outreach read as bulk email.
What's real: if a person explicitly asks to stop being contacted, that's
respected — permanently, via the same opt-out list Phase 5 built. SPEC.md
§29's `UNSUBSCRIBE` classification category is implemented here as
**`STOP_CONTACT`** — same enforcement, but named for what it actually is:
someone asking a person to stop emailing them, not a list opt-out.

- **`src/agents/conversation-intelligence-agent.ts`** — classifies one
  reply (INTERESTED / QUESTION / OBJECTION / PRICE / NOT_INTERESTED /
  NOT_NOW / ALREADY_HAS_SOLUTION / WRONG_PERSON / REFERRAL / STOP_CONTACT
  / HOSTILE / OUT_OF_OFFICE / UNKNOWN) and extracts buying intent,
  objections, appointment intent, sentiment, confidence. It does **not**
  decide what happens next — same split as Qualification (Phase 2):
  the model reports signals, `src/outreach/reply-routing.ts` (deterministic
  code) decides the action.
- **Routing** (`reply-routing.ts`): STOP_CONTACT → suppress, permanently.
  PRICE/HOSTILE → escalate to Gavin, never an autonomous reply. A clear
  no or an existing solution → close the deal Lost. A low-confidence
  UNKNOWN → escalate rather than guess. Everything else routine
  (INTERESTED, QUESTION, OBJECTION, NOT_NOW, WRONG_PERSON, REFERRAL, a
  confident UNKNOWN) → an autonomous reply, through the exact same
  send-guard Phase 5 built (opt-out/kill-switch/window/warm-up all still
  apply to a reply).
- **`src/agents/outreach-reply-agent.ts`** — answers what they actually
  wrote, not a generic pitch continuation. Same "sounds like a specific
  person, not AI" bar as Phase 4/5 (Gavin, 2026-09-XX: "it should come
  off as 'woah this is perfect for me,'" not a template).
- **`src/agents/appointment-agent.ts`** + **`src/outreach/booking-link.ts`**
  — when appointment intent is detected, the reply includes a real
  `hartwich-os/book?company=&contact=&deal=` link instead of proposing
  times itself. "Never invent availability" (`SPEC.md` §31) is structural
  here, not a prompt rule: the model never sees calendar data at all —
  hartwich-os's own existing, working, Google-Calendar-backed booking page
  does that entire job; this repo only builds the link.
- **`src/integrations/gmail.ts`** (extended) — reading unread mail across
  all 3 accounts and in-thread reply sending (proper In-Reply-To/
  References headers + Gmail `threadId`), reusing the exact OAuth setup
  Phase 5 already has.
- **`src/tools/get-unread-replies.ts`** — matches unread mail back to a
  thread we started (same rule hartwich-os's own `sync-replies.ts` uses)
  and skips anything that isn't a reply to us.
- **`src/db/hartwich-os/write-store.ts`** (`recordInboundReply`,
  `moveDealToLostStage`, `flagDealForReview`) — a reply is recorded as a
  real activity/message and moves Contacted → Engaged, visible in
  hartwich-os's existing timeline exactly like Phase 5's sends.
- **`src/tools/notify-gavin.ts`** — the actual human-in-the-loop step for
  PRICE/HOSTILE: an alert email, not a silent skip.
- **`src/db/hartwich-os/write-store-stub.ts`** — a `NotImplementedWriteStore`
  base class every fake/demo `HartwichWriteStore` now extends, overriding
  only what it exercises, instead of hand-writing a stub for every method
  each time the interface grows one (every phase so far has added at
  least one) — a small refactor, not new behavior.

`npm run demo:handle-replies` classifies a fixture reply and runs it all
the way through — appointment intent detected, real booking link
generated, sent in-thread, recorded — no credentials, no approval step.

## Phase 7 status — done

The CRM Agent (`SPEC.md` §55 Phase 7). Most of hartwich-os's CRM was
already updating itself automatically as a side effect of Phases 2-6 —
this phase's job (`SPEC.md` §32: "human CRM administration should
approach zero") was closing the specific gaps `GAP_ANALYSIS.md` flagged,
not rebuilding what already worked.

- **`src/db/hartwich-os/write-store.ts`** — every write now also inserts
  an `audit_log` row (`GAP_ANALYSIS.md` §3 gap #7: the table existed in
  hartwich-os's own schema but nothing had ever written to it). Every
  `HartwichWriteStore` method now takes an `actor: string` — threaded
  through from the existing `ctx: ToolContext` (`agentId`) every tool
  already receives, so "which agent made this change" is on the record
  without adding a redundant field to any tool's Zod input schema.
- **`src/tools/create-escalation-task.ts`** + a new hartwich-os `tasks`
  table — a PRICE/HOSTILE escalation, or a reply with no contact/deal on
  file, now also creates a task due a few hours out, so it shows up on
  Gavin's existing `/calendar` page, not only as a `notify_gavin` email
  (`SPEC.md` §32's "create tasks").
- **`src/tools/append-company-note.ts`** + **`src/outreach/notes.ts`** —
  closing a deal Lost or escalating a reply now appends a timestamped
  note to the company record (`SPEC.md` §32's "record decisions"),
  additive only — it never overwrites anything Gavin wrote by hand.
- **`src/outreach/app-url.ts`** — a real link to the company's hartwich-os
  page in both the escalation email and the new task's description, same
  pattern as Phase 6's booking link: build the URL, don't invent one.
- **`src/pipelines/handle-inbound-replies.ts`** — wires the above into
  the `close_lost`/`escalate` routes, plus a `create_escalation_task`
  call in the pre-existing "reply has no contact/deal on file" fallback.
  These are secondary bookkeeping calls, not the primary outcome already
  decided — a new `invokeBestEffort` helper logs a failure instead of
  silently swallowing it (the pre-existing `close_deal_lost`/
  `flag_deal_for_review` calls had this same gap; fixed here too) or
  letting a note/task failure look like the reply itself was mishandled.
- **`src/policy/default-rules.ts`** — both new tools are
  `AUTONOMOUS_ROUTINE`, the same level as every other CRM write —
  "create tasks" and "record decisions" are on `SPEC.md` §32's list of
  autonomous CRM Agent responsibilities, not a new authority level.

**Deliberately out of scope:** hartwich-os's `sequences`/`sequence_steps`
tables stay unused, consistent with `GAP_ANALYSIS.md`'s existing finding
that they're dead schema — not force-fit into this phase. And no code
path here ever moves a deal to **Won** autonomously; that's a genuine
commercial/contractual event, and "AI shouldn't change the business
model" (an existing Sales Manager principle in `SPEC.md`) extends
naturally to "AI shouldn't declare a sale won" — that stays a human
action in hartwich-os itself.

`npm run demo:handle-replies` now runs two scenarios back to back: the
existing INTERESTED+appointment-intent autonomous reply (Phase 6), and a
new PRICE reply that gets escalated — flagged for review, a company note
appended, and a task created (Phase 7) — instead of an autonomous reply.

## Phase 8 status — done

The Sales Analyst (`SPEC.md` §55 Phase 8, §33). Phase 3 already built the
"is THIS goal on track" machinery (KPI Engine, Pace, Forecast, Bottleneck
Detection); Phase 8 is a second, wider lens — SPEC.md §33's four
categories (funnel, business, efficiency, quality) for the whole business
over a period, not one goal at a time — built entirely out of that same
KPI Engine, not a parallel measurement system.

- **`src/goals/kpi-engine.ts`** — three metrics that were an honest
  `value: null, confidence: 0` since Phase 3 (there was nothing to read
  yet) are wired up now that Phase 6/7 actually produce the data:
  `outreach_sent`/`follow_ups_completed` read Phase 7's own `audit_log`
  rows (`email.cold_outreach_sent`/`email.follow_up_sent` — already
  written for Phase 7's own reasons, reused rather than duplicated), and
  `positive_conversations` reads this repo's own `agent_runs` for
  Conversation Intelligence classifications of `INTERESTED` (confidence
  0.8, not 1 — it's a model's classification, not a verified label).
  `human_hours_per_client` stays a deliberate null — nothing times a
  human's minutes, and estimating it from agent activity would be a
  fabricated number wearing a KPI's clothes.
- **Five new metrics** for SPEC.md §33's business/efficiency/quality
  categories, all deterministic: `close_rate` (won ÷ (won + lost)),
  `prospects_per_client`, `human_escalations` (Phase 7's
  `task.created` audit rows — the concrete "human intervention" signal,
  not an estimate), `opt_outs` (this repo's own `suppressed_contacts`),
  and `agent_error_rate` (1 − `agent_success_rate`).
- **`src/db/hartwich-os/funnel-reader.ts`** — `countDealsLost` (mirrors
  the existing `countDealsWon`) and a generic `countAuditAction(action,
  period)` that both new outreach/escalation metrics above read from.
- **`src/db/analytics-reader.ts`** (new) — read-only queries over this
  repo's own database for the two metrics that live there
  (`agent_runs`, `suppressed_contacts`), kept separate from
  `AgentHealthReader` (a narrower, genuinely-just-agent-health concern)
  rather than overloading it.
- **`src/goals/sales-analyst-report.ts`** — `getSalesAnalystReport(period,
  deps)` groups all of the above, plus Phase 3's existing bottleneck
  diagnosis, into one report shaped like SPEC.md §33. Two things it
  names are deliberately absent rather than faked: **response quality**
  has no code-checkable definition (a judgment call about tone/relevance
  — a real LLM-as-judge agent for a later phase, not a KPI Engine case),
  and **qualification accuracy** needs a ground-truth label (did a
  qualified lead convert, would a disqualified one never have) that
  nothing in hartwich-os captures yet. **Data confidence** instead gets a
  real, computable definition: the mean confidence across every KPI
  value in the report itself — how much of *this report* should be
  trusted, not a property of hartwich-os's records.

`npm run demo:sales-analyst` runs the whole report against fixtures
carrying the funnel forward from where `demo:goal-status`'s story left
off — outreach sent, some replies, a couple of closed deals, one
escalation — no credentials needed.

## Phase 9 status — done

The Sales Manager control loop (`SPEC.md` §55 Phase 9: "GOAL → PLAN →
DELEGATE → EXECUTE → MEASURE → OPTIMIZE"). Every earlier phase built one
piece of this loop; `src/manager/sales-manager.ts` is the first thing
that actually runs it, per goal, per cycle — closing the TODO Phase 3
itself left behind ("Phase 9's Sales Manager is what actually chooses
and executes an intervention").

- **PLAN** — `SalesManager.runCycle` calls `getGoalStatusReport` (Phase 3)
  for the diagnosis, then `src/manager/intervention-generator.ts`
  (`SPEC.md` §14 steps 2-5) proposes at most **one** real candidate
  action — not a menu of hypothetical options with invented numbers.
  Its `expectedImpact` reuses `detectBottleneck`'s own
  `impactOnFinalStage` directly. `src/manager/work-intensity.ts` maps
  the goal's forecast status onto `SPEC.md` §15's NORMAL/BEHIND/
  AGGRESSIVE/CRITICAL ladder — how big an ask the manager makes scales
  with how far behind the goal is (20%/50%/100% more discovery volume).
- **DELEGATE/EXECUTE** — `src/manager/authority-policy.ts` implements
  `SPEC.md` §18's `AuthorityPolicy` as a small, configurable table (data,
  not code, same philosophy as `src/policy/default-rules.ts`). When the
  proposed action is in-authority, the manager actually does it: triggers
  more Prospect Discovery volume (`src/config/icp-targets.ts` — the same
  hardcoded HVAC ICP the rest of the system uses) for an upstream funnel
  gap, or creates a controlled experiment (`ExperimentStore` — real
  infrastructure from an earlier phase that had no caller until now) for
  a downstream conversion gap, using one fixed, pre-approved copywriting
  variation rather than LLM-invented messaging. A repeat cycle against
  the same stage never stacks a second experiment on top of one still
  gathering samples (`SPEC.md` §34) — it escalates instead.
- **Escalation** — when the needed change exceeds the manager's own
  authority (e.g. the fix that would actually help needs +100% volume,
  but the autonomous cap is +20%), it escalates instead of overstepping
  or silently doing nothing, using `SPEC.md` §37's exact format
  (GOAL/CURRENT FORECAST/ISSUE/RECOMMENDATION/EXPECTED IMPACT/RISK/WHY
  APPROVAL IS REQUIRED) via Phase 7's existing `notify_gavin` and
  `create_escalation_task` tools — no new escalation mechanism invented.
- **MEASURE** — the KPI snapshot/forecast recording `getGoalStatusReport`
  already did, plus (new in Phase 9) a real `manager_decisions` row per
  cycle with actual `options`/`selectedAction`/`reason`/`expectedOutcome`
  — the table's shape never changed since Phase 3 (`db/schema.ts`'s own
  comment said this table was built "so Phase 9 extends this table's
  usage, not its structure"), only who writes to it and what they write.
  `getGoalStatusReport` itself no longer records a decision — one clear
  owner of "what should we do about it," not two.
- **OPTIMIZE** — `runAll()` re-runs the loop for every active goal;
  calling it on a recurring schedule is deployment-level wiring, same as
  every other pipeline in this repo (none of them own their own cron
  either).

Deliberately LLM-free, like every engine it's built from (KPI Engine,
Bottleneck Engine, Pace/Forecast) — there's nothing left for a model to
classify here: the diagnosis is already real numbers, and choosing the
best of at most one in-authority option is arithmetic, not judgment.

**Deliberately out of scope:** measuring which experiment variant is
actually winning and auto-stopping a failed one (`SPEC.md` §17's "stop
failed experiments") — that needs real per-variant outcome data this
system doesn't attribute yet, an honest gap rather than a fabricated
conclusion from too small a sample (`SPEC.md` §34). A full closed-loop
`actualOutcome` backfill (`SPEC.md` §35's Learning Loop) is similarly
left for later — this phase decides and records, it doesn't yet compare
a past decision's prediction to what really happened.

`npm run demo:sales-manager` runs two goals through one cycle: one
BEHIND goal gets an autonomous 20%-bigger discovery run (within
authority), and one CRITICAL goal — where the fix that would actually
help needs a 100% increase — gets escalated to Gavin in `SPEC.md` §37's
exact format instead. No credentials needed.

## Running it

```bash
npm install
cp .env.example .env   # optional for the demo/tests — see below. Must be .env, not .env.local:
                        # every entrypoint does `import "dotenv/config"`, which only auto-loads
                        # .env (the .env.local convention is Next.js-specific, not general Node/tsx).

npm run typecheck
npm test                      # no network, no credentials needed
npm run demo:company-lookup   # Phase 1 demo — runs end-to-end against a fixture
npm run demo:discover         # Phase 2 demo — full discovery/research/qualification pipeline against fixtures
npm run demo:goal-status      # Phase 3 demo — goal/KPI/pace/forecast/bottleneck report against fixtures
npm run demo:outreach         # Phase 4 demo — strategy -> generation -> draft against a fixture
npm run demo:execute-outreach # Phase 5 demo — autonomous send, guard checks and all, against a fixture
npm run demo:handle-replies   # Phase 6/7 demo — classify replies, autonomous reply + escalation with CRM note/task
npm run demo:sales-analyst    # Phase 8 demo — funnel/business/efficiency/quality report for a period, against fixtures
npm run demo:sales-manager    # Phase 9 demo — the manager plans, executes within authority, or escalates, per goal
npm run cycle                 # THE REAL THING — one full cycle against real credentials, see "Running it for real" below
```

Both demos use real Groq/Anthropic calls only if their API keys are set,
otherwise they fall back to canned `FakeModelProvider` responses.

`npm run db:generate` / `npm run db:migrate` (Drizzle) apply **this
repo's own** schema (`src/db/schema.ts`) to `AGENT_DATABASE_URL` — never
`hartwich-os`'s database.

### Running it for real

`src/cli/run-cycle.ts` (`npm run cycle`) is the actual deployment
entrypoint — not a demo. It wires every pipeline to the real
`Postgres*`/`Google*` implementations (not fixtures) and runs one full
cycle in SPEC.md's own order: Prospect Discovery → Outreach Execution
(every qualified-but-uncontacted lead, via the new
`get_new_lead_candidates` tool) → Follow-Ups → Inbound Replies → the
Sales Manager, last, since it depends on the KPI data every stage above
just produced. Each stage is independently try/caught and logged, so one
failing (e.g. an expired Gmail token) doesn't stop the others.

Needs `AGENT_DATABASE_URL`, `HARTWICH_DATABASE_URL`, and `GROQ_API_KEY`
at minimum (it exits with a clear error if any are missing); every other
`.env.example` var is checked too, with a warning naming exactly which
stage will fail without it, rather than a silent partial run.

`.github/workflows/cron.yml` runs it hourly via `workflow_dispatch`/
`schedule`, mirroring hartwich-os's own cron dispatch mechanism
(GAP_ANALYSIS.md §2) rather than inventing a second scheduler. The
guardrails that make hourly (or more frequent) runs safe — opt-out, the
`outreach-control` kill switch, send-window, per-account warm-up caps —
live inside the app itself (`src/outreach/*`), not in the schedule, so
they hold regardless of cron frequency. Populate the workflow's required
secrets (listed in its header comment, one per `.env.example` var) before
enabling it.

## What's next

`SPEC.md` §55's numbered roadmap (Phase 0-9) is now built end to end —
`SPEC.md` §56's "V1 Definition of Done" ("Gavin creates a sales goal →
walks away → Sales Manager creates a plan → agents execute routine
work...") describes what this repo now does, not what's left. Real
deployment wiring (`npm run cycle` + `.github/workflows/cron.yml`, above)
is done; what remains is deliberately-deferred, honestly-flagged work
rather than a new phase number:

- Per-variant experiment outcome measurement and auto-stopping a failed
  one (`SPEC.md` §17/§34) — `src/experiments/assignment.ts`'s
  deterministic hash means no new assignment table is needed to measure
  this later, but the measurement itself doesn't exist yet.
- `SPEC.md` §35's Learning Loop — comparing a `ManagerDecision`'s
  `expectedOutcome` against what actually happened, once enough cycles
  have run to compare against.
