# HARTWICH LABS — AUTONOMOUS AI SALES WORKFORCE

**Master Claude Code Build Guidelines — Updated (canonical, supersedes the
original "Master Build Specification V1" for operating philosophy).**

This is the authoritative build spec for this repo, saved here so it
travels with the code rather than living only in chat history. Two things
changed from the original V1 spec that this repo's earlier work
(`GAP_ANALYSIS.md`, Phase 1 runtime) was built against, both from direct
instruction from Gavin:

1. **Autonomous by default, human approval by exception** (this doc's §2),
   replacing V1's implicit "AI proposes, Gavin approves every action" framing.
   Routine work — prospecting, research, qualification, approved-boundary
   outreach, follow-ups, routine conversation handling, CRM updates,
   booking — should run without a human in the loop. Approval is reserved
   for strategic/financial/compliance-sensitive/irreversible/out-of-authority
   decisions (§17).
2. Claude/Anthropic usage is unblocked (Gavin's direct instruction,
   2026-09-09) — see `GAP_ANALYSIS.md` §8. The "strong" model lane (§42)
   is a live Anthropic provider, not a stub.

The ICP stays deliberately HVAC-specific — that's who Hartwich Labs
services — expressed as configuration (thresholds, geography), not a
generic multi-vertical switcher.

Everything below is Gavin's own text, unedited.

---

## 1. MISSION

Build an AI sales workforce for Hartwich Labs that can operate mostly autonomously toward measurable business goals.

Hartwich Labs' current core service is:

Google review automation / reputation-management and review-request systems for businesses.

The objective is not to build a collection of disconnected AI agents.

The objective is to build an AI sales organization.

The system should eventually allow Gavin to say:

"Get us 10 new clients this month."

and have the Sales Manager:

1. understand the goal
2. calculate the required sales activity
3. inspect current performance
4. identify bottlenecks
5. create a plan
6. assign work to agents
7. execute routine work autonomously
8. monitor results
9. increase/decrease effort intelligently
10. experiment when necessary
11. learn from results
12. escalate only important decisions to Gavin

The system should require minimal human babysitting.

---

## 2. CORE PRINCIPLE

Autonomous by default. Human approval by exception.

Do NOT design the system around:

AI proposes every action
↓
Gavin approves every action
↓
AI executes

That creates an AI assistant, not an AI workforce.

Instead:

Gavin establishes goals + boundaries
↓
Sales Manager operates independently
↓
Agents execute routine work
↓
Manager monitors outcomes
↓
Manager adjusts work
↓
Manager escalates consequential decisions

Human approval should primarily be required for:

* strategic changes
* major financial decisions
* pricing changes
* major offer changes
* major ICP changes
* new channels
* unusual/high-value negotiations
* legal/compliance-sensitive situations
* irreversible actions
* actions outside established authority
* genuinely ambiguous situations

Routine work should happen automatically.

---

## 3. THE SALES ORGANIZATION

Initial structure:

```
                         GAVIN
                           │
                    BUSINESS OBJECTIVES
                           │
                           ▼
                    SALES MANAGER
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
 PROSPECTING            OUTREACH            PIPELINE
   MANAGER               MANAGER             MANAGER
       │                   │                   │
       ▼                   ▼                   ▼
   Workers              Workers             Workers
       │                   │                   │
       └───────────────────┼───────────────────┘
                           ▼
                    SALES INTELLIGENCE
                           │
                           ▼
                    HARTWICH OS / DATA
```

Do not necessarily implement separate manager agents immediately.

The architecture must support them later.

Initially, the Sales Manager can directly coordinate worker agents.

---

## 4. INITIAL AGENTS

Build these capabilities:

1. Prospect Discovery Agent
2. Prospect Research Agent
3. Qualification Agent
4. Outreach Strategy Agent
5. Outreach Generation Agent
6. Outreach Execution Agent
7. Conversation Intelligence Agent
8. Follow-Up Agent
9. Appointment Agent
10. CRM Agent
11. Sales Analyst Agent
12. Sales Manager Agent

These are capabilities within a shared workforce architecture.

Do not create 12 completely independent applications.

---

## 5. HARTWICH OS INTEGRATION

Hartwich OS already exists.

It contains CRM infrastructure including:

* companies
* contacts
* deals
* pipeline stages
* activities
* messages
* templates
* outreach sequences
* sequence steps
* tasks
* AI runs
* lead-source configuration
* audit logs

The new system must integrate with this existing infrastructure.

**IMPORTANT**

Do NOT build a second CRM.

Do NOT duplicate companies, contacts, deals or messages.

Use Hartwich OS as the existing operational data layer.

Initially:

```
AI Workforce
      ↓
Hartwich OS
      ↓
Database
```

Eventually:

```
AI Workforce
      ↓
Hartwich Intelligence Core
      ↓
Shared Data Core
      ↓
Human Interface
```

Hartwich OS should gradually become less dependent on manual operation as the AI workforce becomes capable of managing it.

Do not delete or rewrite existing functionality simply to achieve this.

*(This repo, `ai-workforce`, is the separate service referenced above —
confirmed by Gavin, 2026-09-09. It owns its own database for agent-runtime
state and talks to hartwich-os's database through a narrow tool layer; see
`GAP_ANALYSIS.md` and `README.md`.)*

---

## 6. FIRST INSTRUCTION TO CLAUDE CODE

Before writing code:

INSPECT EVERYTHING.

*(Done — see `GAP_ANALYSIS.md`.)*

---

## 7. SALES MANAGER IS THE BRAIN

The Sales Manager is not simply a reporting chatbot.

It is the operational brain of the sales workforce.

Its responsibility is:

Achieve assigned goals using available resources while staying within authority, quality, compliance and operational constraints.

It must continuously answer:

What are we trying to achieve?
Where are we now?
Are we on pace?
What is preventing us from winning?
What action has the highest expected impact?
Which agent should perform it?
Did it work?
What should happen next?

---

## 8. GOAL SYSTEM

Goals are first-class objects.

Support:

**Business outcomes** — new clients, revenue, MRR, closed deals.

**Sales outcomes** — meetings, qualified opportunities, positive conversations.

**Leading indicators** — qualified prospects, researched prospects, outreach, follow-ups, conversations.

**Efficiency** — revenue per prospect, meetings per 100 prospects, clients per 1,000 prospects, human hours per client, agent utilization.

---

## 9. GOAL DECOMPOSITION

The manager must work backward from the desired outcome, using:

1. actual historical Hartwich performance
2. rolling conversion rates
3. sufficient sample sizes
4. configurable fallback assumptions when data is insufficient

The manager must continually replace estimates with real data.

---

## 10. KPI ENGINE

Every important KPI should track: Current, Target, Expected, Variance, Trend, Forecast, Confidence, Status.

The KPI engine should be deterministic. Do not allow an LLM to perform critical KPI arithmetic when normal code can do it reliably. Use the LLM for interpretation and strategic reasoning.

---

## 11. FORECASTING

The manager must continuously forecast final outcomes:

current progress + expected remaining production = projected final outcome.

The forecast should update as new results arrive.

---

## 12. PACE

The manager must understand time — target/expected/actual/gap for the period so far — but also current velocity, recent velocity, pipeline, agent capacity, conversion trends, and remaining time. Do not treat a temporary daily fluctuation as a crisis.

---

## 13. BOTTLENECK DETECTION

Funnel: Prospects → Qualified → Contacted → Replies → Positive Replies → Meetings → Shows → Opportunities → Clients → Revenue.

For every stage, calculate volume, conversion, expected conversion, variance, and impact on the final goal, then identify the highest-impact bottleneck.

---

## 14. INTELLIGENT RESPONSE TO MISSED GOALS

If the goal is behind: **do not increase every agent's workload.**

1. Detect gap.
2. Diagnose bottleneck.
3. Generate possible interventions.
4. Estimate expected impact.
5. Consider cost/risk.
6. Choose highest-leverage action.
7. Allocate workforce.
8. Execute.
9. Measure.
10. Continue or change strategy.

This is what "work harder" should mean.

---

## 15. WORK INTENSITY

States: NORMAL, BEHIND, AGGRESSIVE, CRITICAL.

- NORMAL — standard operating pace.
- BEHIND — increase effort around the bottleneck.
- AGGRESSIVE — increase capacity and experimentation within limits.
- CRITICAL — attempt recovery while preparing escalation to Gavin.

Do not hard-code multipliers — use configurable policies. The manager should increase useful throughput, not spam.

---

## 16. RESOURCE ALLOCATION

Each agent has capacity, current workload, queue length, utilization, success rate, latency, failure rate. The manager can dynamically allocate work toward high-impact bottlenecks, without overwhelming agents or external systems.

---

## 17. AUTONOMY BOUNDARIES

Use capability-based permissions.

**Autonomous** — the manager may independently: discover prospects, research prospects, deduplicate, qualify prospects, rank prospects, create tasks, assign work, adjust workload, generate outreach, test approved messaging, execute approved outbound, perform follow-ups, classify replies, handle routine conversations, update CRM, book meetings, analyze KPIs, create controlled experiments, stop failed experiments, reprioritize pipeline, respond to KPI misses, optimize within established constraints.

**Human confirmation required** — changing pricing, changing the core offer, major ICP changes, launching a new channel, significant spend, major campaign changes outside predefined limits, unusual negotiations, contracts, legal/compliance exceptions, major strategic changes, high-value unusual opportunities, irreversible high-impact actions.

The system should be designed so that Gavin sees decisions, not hundreds of routine actions.

---

## 18. AUTHORITY BOUNDARIES

Create a formal authority model.

```ts
interface AuthorityPolicy {
  capability: string;
  autonomyLevel: number;
  maxVolume?: number;
  maxBudget?: number;
  maxChangePercent?: number;
  requiresApproval?: boolean;
}
```

Thresholds must be configurable (e.g. +20% campaign volume autonomous, +300% requires approval; changing pricing always requires approval).

---

## 19. POLICY ENGINE

Every consequential external action goes through:

Agent → Action Proposal → Policy Engine → Authority Check → Compliance Check → Rate Limit → Duplicate Check → Approval if required → Execution → Verification → Audit Log.

No LLM should have unrestricted direct access to external systems.

---

## 20. OUTBOUND AUTONOMY

Routine outbound should eventually be autonomous — not manually approved message by message. Establish approved offer, positioning, channels, messaging rules, personalization rules, sending limits, compliance rules; within those boundaries the Outreach Agent operates independently. New strategies outside those boundaries escalate.

---

## 21. OUTREACH QUALITY

Optimize positive replies, meetings, clients, revenue — not messages sent. Monitor delivery rate, bounce rate, reply rate, positive reply rate, opt-out rate, meeting conversion, close rate, complaint signals. Volume rising while quality falls is a negative result.

---

## 22. COMPLIANCE

Respect applicable Canadian anti-spam requirements, platform rules, channel restrictions, opt-outs, sending limits, privacy requirements, truthful marketing.

Never fabricate testimonials, results, relationships, customer names, statistics, conversations, urgency, guarantees. Hartwich's service must be represented accurately. Do not build deceptive review practices — any review-request/reputation functionality must pass through a compliance layer and must not facilitate prohibited manipulation of Google reviews. Do not claim guaranteed Google rankings.

---

## 23. PROSPECT DISCOVERY AGENT

Discover businesses, deduplicate, check Hartwich OS, collect business data, identify potential decision makers, pass prospects into research. Targeting configurable (geography, industry, review count, rating, locations, business size, ICP criteria, exclusions). The agent should learn which prospect characteristics correlate with successful sales.

---

## 24. RESEARCH AGENT

Research the business (name, category, website, location, Google profile, rating, review count, review activity, observable reputation signals, locations) and contact (owner, founder, president, GM, marketing decision maker, other relevant contact). Identify sales signals (reputation opportunity, growth, customer acquisition, multiple locations, weak review infrastructure, recent review activity, visible pain points). Every important claim needs evidence.

---

## 25. QUALIFICATION AGENT

Configurable deterministic scoring model:

```
ICP FIT             30%
OPPORTUNITY         25%
CONTACTABILITY      15%
BUSINESS QUALITY    15%
TIMING              10%
DATA CONFIDENCE      5%
```

```ts
interface QualificationResult {
  score: number;
  tier: "A+" | "A" | "B" | "C" | "D";
  reasons: string[];
  evidence: Evidence[];
  confidence: number;
}
```

Do not let the LLM silently modify the scoring formula.

---

## 26. OUTREACH STRATEGY AGENT

Determine target channel, messaging angle, evidence, hook, CTA, sequence, personalization — using historical performance when available (which segment responds, which message converts, which channel works, which CTA books meetings).

---

## 27. OUTREACH GENERATION AGENT

Generate initial outreach, follow-ups, replies, objection responses. Messages: concise, natural, evidence-based, personalized, truthful, aligned with approved Hartwich positioning.

---

## 28. OUTREACH EXECUTION AGENT

Sends approved/autonomous outbound. Never bypass policy, rate limits, opt-outs, duplicate protection, sending windows, audit logging. Reports execution results back to the workforce.

---

## 29. CONVERSATION INTELLIGENCE

Classify inbound: INTERESTED, QUESTION, OBJECTION, PRICE, NOT_INTERESTED, NOT_NOW, ALREADY_HAS_SOLUTION, WRONG_PERSON, REFERRAL, UNSUBSCRIBE, HOSTILE, OUT_OF_OFFICE, UNKNOWN. Extract intent, objection, buying signal, requested action, timing, decision-maker status, next step, confidence. Routine conversations handled autonomously; unusual/high-impact conversations escalate.

---

## 30. FOLLOW-UP AGENT

Automatically manage unanswered prospects, promised follow-ups, interested prospects, stale opportunities, pending information, meeting reminders. Stop on opt-out, explicit rejection, invalid contact, human takeover, or policy restriction.

---

## 31. APPOINTMENT AGENT

Handle meeting intent, availability, scheduling, rescheduling, confirmation, CRM updates. Never invent availability.

---

## 32. CRM AGENT

Maintain Hartwich OS automatically — companies, contacts, activities, messages, tasks, pipeline, deals, sequences, notes, outcomes. Human CRM maintenance should approach zero for normal workflows.

---

## 33. SALES ANALYST

Analyze the funnel (prospect→qualified→contacted→reply→positive→meeting→opportunity→client), business metrics (revenue, clients, MRR, close rate), efficiency (agent utilization, human intervention, human minutes, prospects per client, revenue per prospect), and quality (response quality, qualification accuracy, data confidence, opt-outs, errors).

---

## 34. EXPERIMENT ENGINE

Run controlled experiments autonomously within approved boundaries. Require sufficient sample size. Do not make major strategy decisions from tiny samples.

---

## 35. LEARNING LOOP

Expected result → actual result → difference → learning, fed back as structured organizational memory.

---

## 36. MANAGER DECISION ENGINE

```ts
interface ManagerDecision {
  goalId: string;
  observation: string;
  diagnosis: string;
  options: {
    action: string;
    expectedImpact: number;
    confidence: number;
    risk: number;
  }[];
  selectedAction: string;
  reason: string;
  expectedOutcome: string;
  actualOutcome?: string;
}
```

---

## 37. HUMAN ESCALATION

Escalation should be intelligent — context and a recommendation, not raw agent confusion:

```
GAVIN — DECISION REQUIRED
GOAL: 10 new clients
CURRENT FORECAST: 7.1
ISSUE: Current ICP is becoming saturated.
RECOMMENDATION: Expand targeting into adjacent segment.
EXPECTED IMPACT: +2.3 clients
RISK: Medium
WHY APPROVAL IS REQUIRED: This changes the approved ICP boundary.
[APPROVE] [REJECT]
```

---

## 38. APPROVAL QUEUE

Centralized approval system. Each approval carries decision, reason, expected impact, risk, evidence, recommended action, expiration. Prioritize — low-value approvals must not bury high-value ones.

---

## 39. SHARED MEMORY

Structured organizational memory for prospect intelligence, contact intelligence, conversations, campaigns, messaging performance, conversion rates, goals, decisions, experiments, manager learnings, agent performance. Agents retrieve relevant context instead of receiving enormous prompts.

---

## 40. EVENT-DRIVEN ARCHITECTURE

`PROSPECT_DISCOVERED`, `PROSPECT_RESEARCHED`, `PROSPECT_QUALIFIED`, `OUTREACH_CREATED`, `OUTREACH_SENT`, `MESSAGE_RECEIVED`, `MESSAGE_CLASSIFIED`, `FOLLOWUP_DUE`, `MEETING_BOOKED`, `MEETING_COMPLETED`, `DEAL_UPDATED`, `CLIENT_WON`, `GOAL_CREATED`, `KPI_MISSED`, `BOTTLENECK_DETECTED`, `MANAGER_DECISION`, `APPROVAL_REQUIRED`, `AGENT_FAILURE`.

---

## 41. AGENT RUNTIME

```ts
interface AgentDefinition {
  id: string;
  name: string;
  version: string;
  capabilities: string[];
  tools: string[];
  autonomyLevel: number;
}
```

Execution: Agent definition → Context builder → Model router → LLM → Structured output → Validation → Policy → Tool execution → Verification → Audit.

*(Implemented — src/runtime/agent-runtime.ts.)*

---

## 42. MODEL ABSTRACTION

```ts
interface ModelProvider {
  generate(...): Promise<ModelResponse>;
  structuredGenerate(...): Promise<StructuredResponse>;
}
```

Cheap/fast lane: classification, extraction, normalization, simple routing. Strong lane: difficult research, strategic reasoning, conversation handling, manager decisions. Provider replaceable without rewriting agents.

*(Implemented — src/runtime/model-router.ts, src/runtime/model-providers/{groq,anthropic}.ts. Anthropic is live, not stubbed — see the note at the top of this file.)*

---

## 43. AGENT HEALTH

Monitor success rate, failure rate, latency, queue length, utilization, retry rate, human intervention. The Sales Manager should know when an agent itself is becoming a bottleneck.

---

## 44. SELF-CORRECTION

Agents should detect failed tools, malformed outputs, incomplete research, conflicting data, duplicate prospects, uncertain classifications — and retry or route work appropriately. They should NOT hallucinate a successful result.

---

## 45. GOAL → WORKFORCE LOOP

```
BUSINESS GOAL → GOAL ENGINE → KPI ENGINE → FORECAST → BOTTLENECK DETECTION
→ MANAGER → RESOURCE ALLOCATION → AGENTS → EXECUTION → RESULTS → ANALYTICS
→ FORECAST UPDATE → MANAGER ↺
```

Operates continuously.

---

## 46. "PUSH HARDER" REQUIREMENT

"Push harder" means: increase the probability of achieving the goal — not increase message volume indiscriminately. The manager determines the gap, cause, highest-impact intervention, available capacity, constraints, what it can change autonomously, and what requires Gavin. Then acts.

---

## 47. DAILY MANAGER LOOP

Load active goals → load KPIs → calculate pace → forecast outcomes → detect bottlenecks → inspect workforce health → inspect pending work → determine required actions → allocate resources → execute permitted actions → create experiments if useful → escalate consequential decisions → measure outcomes → update forecasts → record decisions. Runs automatically.

---

## 48. DATABASE ADDITIONS

Add only what is required:

`agents`, `agent_versions`, `agent_runs`, `agent_actions`, `agent_permissions`, `agent_capacity`, `agent_memory`, `agent_metrics`, `sales_goals`, `sales_kpis`, `sales_forecasts`, `manager_decisions`, `manager_actions`, `approval_requests`, `policy_rules`, `experiments`, `experiment_variants`, `experiment_results`.

Do not duplicate existing CRM tables.

---

## 49. GOAL MODEL

```ts
interface SalesGoal {
  id: string;
  metric: string;
  target: number;
  periodStart: Date;
  periodEnd: Date;
  priority: "low" | "normal" | "high" | "critical";
  constraints?: {
    maxDailyOutreach?: number;
    maxBudget?: number;
    maxHumanHours?: number;
    allowedChannels?: string[];
  };
  status:
    | "NOT_STARTED"
    | "ON_TRACK"
    | "AT_RISK"
    | "BEHIND"
    | "CRITICAL"
    | "ACHIEVED"
    | "FAILED";
}
```

---

## 50. AUTONOMOUS CAMPAIGN ADJUSTMENTS

Routine, autonomous: shifting prospects between segments, reallocating agents, changing follow-up timing, pausing poor-performing variants, increasing high-performing prospect research, changing message variants inside approved boundaries, prioritizing better prospects, increasing workload. Large changes (e.g. launching a completely new channel) require approval.

---

## 51. HUMAN TIME AS A KPI

Track human interventions, approvals, minutes, tasks, escalations. Key KPI: human hours per closed client. The goal is not merely automation — it's leverage.

---

## 52. SECURITY

Least privilege. Separate read / write / external communication / financial / administrative / strategic. Do not give every agent every tool (e.g. Research Agent reads business data only; CRM Agent reads+writes CRM; Outreach Agent reads prospects, writes messages, sends only through the controlled communication service; Sales Manager reads analytics, creates tasks, allocates workload, requests actions).

---

## 53. AUDITABILITY

Every autonomous action traceable: who/what acted, agent, version, model, goal, reason, input references, action, tool, timestamp, result, policy decision, human approval if applicable. Must be able to answer "why did the system do this?" for every meaningful action.

---

## 54. TESTING

Agents (valid/invalid outputs, tool failures, hallucination handling), Policies (allowed/denied/approval-required), Goal engine (on track/behind/critical/achieved/forecast failure), Manager (bottleneck detection, correct intervention, workload allocation, escalation, recovery), Autonomy (routine work proceeds without approval; restricted actions stop and request approval).

---

## 55. PHASED IMPLEMENTATION

- **Phase 0** — Inspect current Hartwich OS. No modifications. *(Done — `GAP_ANALYSIS.md`.)*
- **Phase 1** — Agent runtime, tool registry, model abstraction, permissions, policy engine, audit system, structured output validation. *(In progress — this commit.)*
- **Phase 2** — Prospect Discovery, Research, Qualification. Connect to Hartwich OS.
- **Phase 3** — Goal Engine, KPI Engine, Forecasting, Bottleneck Detection, Workforce Capacity, Manager Decision System. System should be able to answer "are we on track to hit our sales goal?"
- **Phase 4** — Outreach Strategy, Outreach Generation, approved messaging system, experiments.
- **Phase 5** — Outreach Execution, Follow-Up. Enable autonomous operation within configured policies.
- **Phase 6** — Conversation Intelligence, Appointment Agent. Enable routine conversation autonomy.
- **Phase 7** — CRM Agent. Automate CRM administration.
- **Phase 8** — Sales Analyst, manager analytics, forecasting improvements.
- **Phase 9** — Activate full Sales Manager control loop: GOAL → PLAN → DELEGATE → EXECUTE → MEASURE → OPTIMIZE.

---

## 56. V1 DEFINITION OF DONE

Gavin creates a sales goal → walks away → Sales Manager creates a plan →
agents execute routine work → manager monitors KPIs → detects bottlenecks →
adjusts workload → runs approved experiments → handles routine
conversations → updates CRM → books meetings → escalates only important
decisions → Gavin receives concise updates.

Gavin should NOT need to manually research every prospect, manually
qualify every prospect, approve every message, manually send every
follow-up, manually classify replies, manually update CRM, or constantly
tell agents what to do.

---

## 57. THE GAVIN INTERFACE

"Get 10 clients this month." / "We're behind. Figure it out." / "Push
harder." / "What is the bottleneck?" / "Why are meetings down?" / "Focus on
the highest-value prospects." / "Stop that campaign." / "Approve the new
segment." — the system handles the operational complexity underneath.

---

## 58. FINAL ARCHITECTURAL PRINCIPLE

Do not build an AI assistant that waits for instructions. Build an AI
organization that receives objectives and manages itself.

```
GAVIN
  │ business objectives
  ▼
SALES MANAGER
  │ goals + KPIs + constraints
  ▼
WORKFORCE
  ├── Prospecting
  ├── Research
  ├── Qualification
  ├── Outreach
  ├── Conversation
  ├── Follow-up
  ├── Appointments
  ├── CRM
  └── Analytics
  │
  ▼
RESULTS → FEEDBACK → SALES MANAGER ↺
```

The manager should be capable of saying: "We're behind target. I know why.
I know what I can change. I'm changing it now. I'll escalate if the
solution exceeds my authority."

---

## 59. MOST IMPORTANT RULE

Do not optimize for autonomy. Optimize for results with the minimum
required human involvement.

If an action is routine, predictable and inside policy: **do it.**
If an action is uncertain but reversible: **test it.**
If an action is important but within the manager's authority: **execute it
and report it.**
If an action materially changes the business or exceeds authority: **ask
Gavin.**

That is the operating model for Hartwich Labs.
