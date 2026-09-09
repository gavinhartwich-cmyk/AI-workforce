# HARTWICH AI SALES WORKFORCE — IMPLEMENTATION GAP ANALYSIS

**Phase 0 deliverable.** No code has been written and nothing in
`hartwich-os` was modified to produce this. Scope: inspect the existing
system (`gavinhartwich-cmyk/hartwich-os`, cloned read-only), map it against
the Master Build Specification, and propose where the AI sales workforce
plugs in. Per the spec's Phase 0 instructions, implementation starts only
after this is reviewed.

Repos involved:
- `gavinhartwich-cmyk/hartwich-os` — the existing product (Next.js CRM +
  lead-mining app). Inspected, **not modified**.
- `gavinhartwich-cmyk/ai-workforce` (this repo) — currently empty. Presumed
  home for the new agent runtime / "Hartwich Intelligence Core," per the
  spec's instruction not to build a second CRM inside `hartwich-os` itself.
  See "Open question" at the end — this needs Gavin's confirmation before
  Phase 1 starts.

---

## 1. Existing infrastructure

**Stack:** Next.js 16 (App Router, TypeScript, Tailwind) on Vercel ·
Supabase (Postgres, Auth) · Drizzle ORM · Inngest (background workflows,
partially wired — see gap #7) · Groq API (`openai/gpt-oss-120b`, strict
structured outputs) · Google Places API (New) · Gmail API (3 rotating
accounts) · Google Calendar API · Twilio (SMS, optional) · Tavily (web
search, optional) · Apollo (paid, optional) · Slack incoming webhooks
(optional). Deployed today on Vercel; a Zo→Vercel hosting migration was
recently completed (`MIGRATION.md`), including replacing two `setInterval`
polling loops with a GitHub Actions cron workflow (`.github/workflows/cron.yml`,
already merged).

**Auth:** Supabase email/password, no public sign-up. A two-person
allow-list (`src/lib/auth/allowlist.ts`) is enforced in `src/proxy.ts` on
every request. One email (`gavinhartwich@gmail.com`) has an extra
"booking admin" permission tier. This is the only permission concept in
the system today — there is no concept of agent-level permissions.

**CRM schema** (`src/db/schema.ts`, Drizzle/Postgres) — this already
matches the spec's §0 CRM foundation almost field-for-field: `users`,
`pipeline_stages` (data, not hardcoded stages), `companies`, `contacts`,
`deals`, `activities`, `messages`, `templates`, `outreach_sequences` /
`sequence_steps`, `tasks`, `ai_runs`, `lead_sources_config`,
`discovery_runs`, `email_drafts`, `email_send_accounts`,
`booking_settings` / `booking_questions` / `bookings`, `audit_log`.

**Prospecting (Phase 2 in hartwich-os's own numbering — "AI Lead Mining
v1"):** `src/lib/actions/discover-leads.ts` (production path, runs via
Next's `after()`) and `src/inngest/functions/discover-leads.ts` (an
Inngest function that exists but isn't invoked in production — see gap
#7) both run the same pipeline: Google Places text search → radius
expansion (15/30/50/75/100mi rings) if short of a target count → dedupe
against existing companies → website enrichment via Groq
(`src/lib/ai/enrich-company.ts`) → decision-maker fallback search via
Tavily+Groq (`src/lib/ai/find-decision-maker.ts`) → qualification →
persist → optional Slack summary. Every AI call is logged to `ai_runs`.

**Qualification:** `src/lib/ai/qualify-lead.ts` is presently a
**deterministic rule**, not an AI call — qualify if review count ≤ 60 OR
rating < 4★. Its own comment records that this intentionally replaced an
earlier AI-scored version (full ICP rubric, franchise blocklist, A/B/C
contact tiers) — that richer path is dead code today, not just unused
config.

**Outreach generation:** `src/lib/ai/draft-outreach.ts` — three Groq-backed
drafting functions (cold outreach, 3/6/9-day follow-up, reply-to-inbound),
each logged to `ai_runs`. All drafts land in `email_drafts` with
`status: pending_review` — nothing sends without a human clicking
approve via `/api/emails/approve-and-send`. This is a real, working
example of the spec's Level-2 autonomy ("prepare + request approval").

**Outreach execution:** `src/lib/integrations/gmail-multi.ts` (3 rotating
Gmail accounts) + `src/lib/warmup/schedule.ts` (per-account daily send
caps on a ramp, plus a minimum 25-minute inter-send spacing) +
`src/lib/emails/send-approved-draft.ts` (send, log activity/message,
record warm-up usage, drive deal-stage transitions by draft `kind`).

**Reply/bounce handling:** `src/lib/emails/sync-replies.ts` matches
inbound Gmail threads back to a sent message by `threadId`, logs an
inbound activity, moves the deal to "Engaged," and drafts a generic
AI reply for review. A separate path detects bounce-notification-shaped
mail, re-enriches the website for a new address, and queues a corrected
draft. **There is no reply classification** — see gap #4.

**Follow-up cadence:** `src/lib/emails/cadence.ts` — day 3/6/9 nudges
(capped at 3), driven off `deals.lastOutboundEmailAt` /
`followUpCount` / `followUpFlaggedAt`, run by a cron route.

**Appointments:** a full, working Calendly-style booking system —
`booking_settings` (window, hours, timezone), `booking_questions`
(customizable), `bookings`, real Google Calendar free/busy (never invents
availability, matching the spec's Appointment Agent requirement exactly),
race-guarded double-booking prevention, email + optional SMS reminders at
24h/1h. It is **not** conversation-driven — it's a public self-serve
`/book` link Gavin sends manually or embeds, not an agent detecting buying
intent in a reply and offering times.

**Observability today:** `ai_runs` (model, tokens, result, status per AI
call) is the only run-level audit trail that exists, and it's specific to
AI calls, not general agent actions.

**Notifications:** `src/lib/notifications/notify.ts` (email to Noah) and
`src/lib/integrations/slack.ts` (optional webhook) — both "something
automated happened, go look," not an escalation/approval system.

---

## 2. Reusable infrastructure

Build **on top of**, do not replace:

- The entire CRM schema and its `src/lib/data/*` accessor layer — this is
  exactly the "clean service/tool layer" the spec asks the agents to sit
  behind (§1). Agents should call these functions (or new ones shaped like
  them), not raw SQL, and never a second set of company/contact/deal
  tables.
- `ai_runs` — extend this into (or feed) the future `agent_runs` audit
  table rather than inventing a parallel log.
- `audit_log` — the table already exists in the schema with the right
  shape for the spec's decision/action history, but **nothing writes to
  it today** (confirmed by repo-wide search). It's ready infrastructure,
  just unused — wire it up rather than adding a new table.
- `src/lib/ai/groq-structured.ts` — a solid, reusable pattern (strict
  JSON-schema completion + Zod validation + 429 retry-with-backoff +
  `ai_runs` logging). This is the right shape for the spec's
  `ModelProvider.structuredGenerate()` — generalize it into the Model
  Router rather than rewriting it per agent.
- `src/lib/integrations/google-places.ts`, `tavily.ts`, `apollo.ts` —
  become tools under the Prospect Discovery / Research agents largely
  as-is.
- `src/lib/integrations/gmail-multi.ts` + `warmup/schedule.ts` — become
  the tool layer under the Outreach Execution agent. The warm-up ramp is
  a real, working instance of the kind of policy the spec's centralized
  Policy Engine needs to absorb (currently it's the *only* rate limit in
  the system, and it's local to Gmail sending, not general).
- `email_drafts` (`pending_review → approved/rejected → sent`) — a
  working approval queue; the Outreach Strategy/Generation agents should
  write into this shape rather than a new "agent proposal" table, at
  least for the outreach channel.
- The booking system — matches the spec's Appointment Agent
  responsibilities (real availability, no invented slots, CRM update,
  Gavin notification) closely enough that the Appointment Agent's job is
  mostly "decide when to hand a prospect a link / auto-book," not rebuild
  booking logic.
- `pipeline_stages` and `lead_sources_config` as data-not-code — matches
  the spec's configurability philosophy; extend this pattern for ICP
  criteria rather than introducing a second config mechanism.
- GitHub Actions cron (`.github/workflows/cron.yml`) — the cron dispatch
  mechanism agents' periodic loops (e.g. the Sales Manager's daily loop,
  §42) can reuse instead of a new scheduler.

---

## 3. Missing infrastructure

Gaps against the 50-section spec, roughly in the order the spec's own
phases would hit them:

1. **No agent runtime.** No `AgentDefinition`, no registry, no generalized
   input→reason→structured-output→validate→policy→tool→verify→audit
   pipeline. Every AI call today is a one-off function tied to one
   feature (enrichment, qualification-that-no-longer-calls-AI, drafting).
2. **No Model Router / provider abstraction.** Groq is called directly
   from feature code. Anthropic is a dependency (`@anthropic-ai/sdk`) but
   **`src/lib/ai/claude.ts`, referenced by `SETUP.md`, does not exist in
   the repo** — the docs are ahead of the code here. There is no
   fast/cheap-vs-strong model routing concept at all.
3. **No goal/KPI/forecasting engine.** No `sales_goals`, `sales_kpis`,
   `sales_forecasts`, `manager_decisions` tables or logic. Nothing
   computes pace, variance, or "expected by today."
4. **No Conversation Intelligence classification.** Every inbound reply
   gets the same treatment: log it, move the deal to Engaged, draft a
   generic AI response. There is no `INTERESTED` / `OBJECTION` / `PRICE` /
   `NOT_INTERESTED` / `UNSUBSCRIBE` / `HOSTILE` / etc. taxonomy, no buying
   intent or sentiment scoring, no `requiresHuman` signal.
5. **No opt-out/unsubscribe handling anywhere** (verified — zero matches
   repo-wide for "unsubscribe," "opt-out," "opt_out"). This is a spec gap
   (§12, §32) and, independently, a real compliance exposure today
   (CAN-SPAM/CASL) for the existing cold-outreach volume — worth flagging
   as urgent regardless of the AI-workforce build.
6. **No centralized Policy/Permission Engine.** The only rate limiting
   that exists is the Gmail warm-up ramp, which is specific to one
   channel and not a general "Action Proposal → Policy → Permission →
   Rate Limit → Approval → Execute → Verify → Audit" pipeline agents are
   forced through. No agent should be able to bypass a check that doesn't
   yet exist to bypass.
7. **Inngest is effectively dead scaffolding in production.** The one
   real Inngest function (`discoverLeads`) exists but, per `MIGRATION.md`,
   production discovery runs through `src/lib/actions/discover-leads.ts`'s
   `after()`-based path instead — `INNGEST_EVENT_KEY`/`SIGNING_KEY` are
   explicitly listed as safe to leave blank. This matters because
   multi-step, retryable, long-running agent workflows (discovery →
   research → qualification → outreach approval) are exactly Inngest's
   use case — decide whether to finish wiring it or standardize on
   `after()` + cron before building agent orchestration on top of either.
8. **Qualification doesn't match the spec's scoring model.** The spec
   wants a weighted, configurable rubric (ICP fit 30% / Opportunity 25% /
   Contactability 15% / Business Quality 15% / Timing 10% / Data
   Confidence 5%, tiered D–A+). The current `qualifyLead()` is a single
   deterministic gate (review count / rating) with `contactTier` and
   `isOwnerOperated` always null and `isFranchise` always false — by
   design, per its own comment, after an earlier AI-scored version was
   deliberately simplified away.
9. **`outreach_sequences` / `sequence_steps` are unused schema.** The
   tables exist; no code anywhere reads or writes them. The actual
   cadence logic (`cadence.ts`) is hand-coded 3/6/9-day intervals, not
   sequence-driven.
10. **Target market is hardcoded to HVAC in several places**, not fully
    data-driven as the spec requires (§5, "do not hard-code a permanent
    niche"): the discovery keyword defaults to `"HVAC contractor"` in two
    places (`discover-leads.ts` action and the Inngest function),
    `hvac-franchise-brands.ts` is a fixed brand list, and the outreach
    drafting system prompts hardcode "HVAC businesses" and "Hartwich Labs
    ... review-management service" as the pitch. `lead_sources_config` is
    a real step toward configurability (keyword/blocklist are already
    data), but geography, business-size, and ICP requirements beyond
    review count/rating aren't represented there yet, and the outreach
    copy itself is vertical-specific.
11. **No agent capacity/workload model** — no `AgentCapacity`,
    utilization tracking, or reallocation logic.
12. **No experiment engine** — no A/B variant tracking, no sample-size
    gating, no reply/meeting/close-rate comparison across variants.
13. **No human-attention instrumentation** — nothing measures human
    minutes, approvals, or interventions per client; no autonomy-level
    concept (Level 0–5) anywhere in the code.
14. **No natural-language command interface** — goals, if they existed,
    would need to be entered structurally; nothing translates "push
    harder this week" into anything.
15. **No event system.** The pipeline is a hand-wired call chain
    (discover → enrich → qualify → persist → notify), not a pub/sub bus
    agents and a manager can subscribe to (`PROSPECT_DISCOVERED`,
    `KPI_MISSED`, `BOTTLENECK_DETECTED`, etc., per §34).
16. **Zero automated tests** of any kind — no `*.test.ts`/`*.spec.ts`
    files exist in the repo. The spec's testing requirements (§48) start
    from nothing.
17. **Appointment booking is not conversation-driven.** It satisfies the
    "never invent availability" requirement well, but nothing today
    detects buying intent in a reply and offers to book — booking is a
    link, not an agent action.

---

## 4. Database changes (Phase 1+, additive only)

New tables needed, none of which duplicate existing CRM entities:

`agents`, `agent_versions`, `agent_runs`, `agent_actions`,
`agent_permissions`, `agent_capacity`, `agent_tasks`, `agent_memory`,
`agent_metrics`, `sales_goals`, `sales_kpis`, `sales_forecasts`,
`manager_decisions`, `manager_actions`, `approval_requests`,
`policy_rules`, `experiments`, `experiment_variants`.

Reused as-is (extended, not replaced): `companies`, `contacts`, `deals`,
`activities`, `messages`, `templates`, `tasks`, `ai_runs`,
`audit_log` (finally written to), `pipeline_stages`,
`lead_sources_config`, `discovery_runs`, `email_drafts`.

`outreach_sequences`/`sequence_steps` should either get real execution
logic (Outreach Strategy agent picks/builds a sequence and something
actually advances prospects through it) or be explicitly retired — leaving
them unused indefinitely would be a second source of truth for the same
concept the new agents will need.

---

## 5. Agent runtime

Build from scratch. `groq-structured.ts`'s
schema-validate-retry-and-log pattern is the one existing primitive worth
generalizing into the runtime's `ModelProvider` implementation for
"fast/cheap" tasks; a second provider wrapping the Anthropic SDK (already
a dependency, currently unused) covers "strong model" tasks, gated behind
the `$0 development budget` flag documented in `hartwich-os/README.md`
until Gavin lifts it (see Security concerns below — this is a business
decision, not a technical blocker).

---

## 6. Goal/KPI engine

Build from scratch — no existing pacing, forecasting, or bottleneck
logic anywhere in `hartwich-os`.

---

## 7. Required integrations

No new external integrations needed for Phase 1 (agent runtime) or
Phase 2 (prospect intelligence) — Google Places, Groq, and Tavily are
already present and usable as agent tools as-is. Gmail, Twilio, and
Google Calendar become the Outreach Execution / Appointment Agent tool
layer starting Phase 4/5, wrapping the existing integration modules
rather than replacing them.

---

## 8. Security concerns

- **The $0 development-budget constraint currently blocks Anthropic API
  usage** (`hartwich-os/README.md` and `SETUP.md` §0 are explicit: "do
  not introduce Anthropic API billing... until this is explicitly
  lifted"). The spec calls for strong-model reasoning (research,
  strategic reasoning, Sales Manager decisions, §36) on Claude. This
  needs an explicit decision from Gavin before Phase 1's model routing
  can include a live Anthropic provider — Phase 1 can and should still
  build the provider abstraction and wire Groq as the working default,
  with Anthropic implemented but disabled behind that flag.
- **No opt-out/compliance mechanism exists today**, independent of this
  project — worth surfacing to Gavin now rather than waiting for the
  Follow-Up Agent phase, since current outreach volume already runs
  without one.
- **No permission model beyond human-user allow-listing.** Agent-level
  autonomy/permission (spec §31–32) is entirely new; it must not be
  confused with or piggyback on the two-person Supabase allow-list, which
  is a human-login gate, not an action-permission system.
- Secrets (Gmail OAuth tokens, API keys, `CRON_SECRET`) live in plain env
  vars with no secrets manager — acceptable at current scale, unchanged
  by this project, but worth naming as a standing item.
- Cron/Inngest routes are already authenticated (bearer secret / signing
  key) — new agent-triggered internal routes should follow the same
  pattern rather than inventing a new one.

---

## 9. Implementation phases (mapped to what already exists)

| Spec phase | Status in `hartwich-os` today |
|---|---|
| Phase 0 — Inspection | **This document.** |
| Phase 1 — Agent Runtime | Greenfield. `groq-structured.ts` is the one reusable building block. |
| Phase 2 — Prospect Intelligence | Rough, working, HVAC-specific version exists (discovery + enrichment + a simplified qualification rule). Needs: configurable ICP beyond review-count/rating, the weighted scoring rubric, and wrapping in the new agent runtime. |
| Phase 3 — Goal/KPI Engine | Greenfield. Build before any autonomy increase, per spec's own ordering. |
| Phase 4 — Outreach Intelligence | Rough, working version exists (`draft-outreach.ts`, human-approval queue). Needs: Outreach Strategy as a distinct reasoned step (channel/angle/hook selection) rather than baked into one drafting prompt, and ICP-agnostic prompts instead of hardcoded HVAC/Hartwich copy. |
| Phase 5 — Outreach Execution | Partially exists (Gmail send, warm-up rate limiting) but **without** a general policy engine, opt-out handling, or duplicate-prevention beyond warm-up spacing. This is real work, not just wrapping. |
| Phase 6 — Conversation + Appointments | Reply/bounce handling and booking both exist; classification, buying-intent detection, and conversation-triggered booking do not. |
| Phase 7 — CRM Automation | Substantially already true for the outreach path (activities/messages/deal-stage updates happen automatically today); needs extending to whatever new agent actions Phases 2–6 add, and `audit_log` needs to actually get written. |
| Phase 8 — Analytics | Greenfield beyond the raw data (`ai_runs`, `activities`, `deals`) already being collected. |
| Phase 9 — Sales Manager | Greenfield, and per the spec's own ordering, correctly last — depends on everything above producing reliable data first. |
| Phase 10 — Closed Loop | Not applicable until 1–9 exist. |

---

## 10. First bounded implementation

**Phase 1 only, scoped exactly as the spec defines it:** agent registry +
agent definitions + agent runtime + model abstraction (wrap
`groq-structured.ts` as the first `ModelProvider`; stub an Anthropic
provider behind the cost-constraint flag, not live) + tool registry +
structured-output validation + permissions + audit logging (wire up the
existing but unused `audit_log` table rather than adding a new one) +
retries/error handling.

**No autonomous outbound messaging in this phase**, per the spec. Definition
of done: one test agent takes structured input, calls the model,
returns structured output, calls one approved read-only tool (e.g.
"look up a company by id" against the existing `src/lib/data/companies.ts`),
passes schema validation, and writes an audit record — proving the whole
pipeline end to end before any prospecting or outreach agent is built on it.

---

## Open question for Gavin

The spec (§1) says the AI workforce should "operate through a clean
service/tool layer" on top of Hartwich OS, without becoming a second CRM.
This repo (`ai-workforce`) is currently empty. Before Phase 1 starts, it
would help to confirm: does the new agent runtime live in **this**
separate repo/service (calling into `hartwich-os`'s Postgres database
directly via a shared `DATABASE_URL` and its Drizzle schema, or via new
API routes exposed from `hartwich-os`), or does it live **inside**
`hartwich-os` itself as a new `src/agents/` area? Either is consistent
with the spec's "don't duplicate the CRM" rule; the choice mostly affects
deployment (one Vercel app vs. two services) and how tightly agent code
can import `hartwich-os`'s existing `src/lib/data/*` accessors versus
needing an HTTP boundary between them.
