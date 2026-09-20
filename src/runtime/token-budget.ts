import { gte, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { groqTokenEvents } from "../db/schema.js";
import type { CallAttribution, ModelUsage } from "./types.js";

/**
 * The agents' share of Groq's free-tier daily token allowance.
 *
 * Groq caps tokens per day per *organization* (200k on the free tier), and
 * the Sales Manager chat in hartwich-os spends from that same pool. On
 * 2026-09-10 the discovery agents used 198,528 of it by mid-afternoon,
 * which left the chat unable to answer a single message — a batch job had
 * silently taken the whole budget from the one interactive feature.
 *
 * So the agents get a budget rather than the whole pool, and the remainder
 * is left for the chat. This is deliberately a soft reservation: nothing
 * stops the chat from spending more than the leftover if it's busy, it just
 * guarantees the agents stop somewhere short of the wall.
 *
 * If GROQ_API_KEY_CHAT is configured on hartwich-os the chat has its own
 * separate 200k and none of this matters much — the reserve then only
 * serves as a backstop. Overridable via GROQ_AGENT_DAILY_TOKEN_BUDGET.
 */
export const GROQ_FREE_TIER_DAILY_LIMIT = 200_000;
export const DEFAULT_AGENT_DAILY_TOKEN_BUDGET = 160_000;

export function agentDailyTokenBudget(): number {
  const raw = process.env.GROQ_AGENT_DAILY_TOKEN_BUDGET;
  if (!raw) return DEFAULT_AGENT_DAILY_TOKEN_BUDGET;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AGENT_DAILY_TOKEN_BUDGET;
}

/** YYYY-MM-DD in UTC. Kept for callers that want a day label; the budget itself is a rolling window. */
export function utcDateKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export type AgentTokenSpend = {
  agentId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  averagePerCall: number;
};

export type BudgetState = {
  usedToday: number;
  budget: number;
  remaining: number;
  exhausted: boolean;
};

export interface TokenBudget {
  /** Add a completed call's tokens to the rolling window, attributed where known. */
  record(usage: ModelUsage, at?: Date, attribution?: CallAttribution): Promise<void>;
  /** How much of the agents' daily budget is left. */
  state(at?: Date): Promise<BudgetState>;
}

/** Groq's cap is a rolling window, so ours has to be the same shape. */
export const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

export class PostgresTokenBudget implements TokenBudget {
  constructor(private budget: number = agentDailyTokenBudget()) {}

  async record(usage: ModelUsage, at: Date = new Date(), attribution?: CallAttribution): Promise<void> {
    const total = usage.inputTokens + usage.outputTokens;
    if (total <= 0) return;

    // Append-only: an event per call, summed over a rolling window at read
    // time. A day-bucket counter can't express "how much have we used in
    // the last 24 hours", which is the only question Groq's cap answers.
    const db = getDb();
    await db.insert(groqTokenEvents).values({
      at,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      agentId: attribution?.agentId ?? null,
      runId: attribution?.runId ?? null,
    });
  }

  async state(at: Date = new Date()): Promise<BudgetState> {
    const db = getDb();
    const since = new Date(at.getTime() - ROLLING_WINDOW_MS);
    const [row] = await db
      .select({
        total: sql<number>`coalesce(sum(${groqTokenEvents.inputTokens} + ${groqTokenEvents.outputTokens}), 0)::int`,
      })
      .from(groqTokenEvents)
      .where(gte(groqTokenEvents.at, since));

    const usedToday = row?.total ?? 0;
    const remaining = Math.max(0, this.budget - usedToday);
    return { usedToday, budget: this.budget, remaining, exhausted: remaining <= 0 };
  }

  /**
   * Token spend per agent over the rolling window — the thing call counts
   * can't tell you. `callCount` is there to make the per-call average
   * visible, since that is what decides whether merging two agents into one
   * call is worth doing.
   */
  async byAgent(at: Date = new Date()): Promise<AgentTokenSpend[]> {
    const db = getDb();
    const since = new Date(at.getTime() - ROLLING_WINDOW_MS);
    const rows = await db
      .select({
        agentId: groqTokenEvents.agentId,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${groqTokenEvents.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${groqTokenEvents.outputTokens}), 0)::int`,
      })
      .from(groqTokenEvents)
      .where(gte(groqTokenEvents.at, since))
      .groupBy(groqTokenEvents.agentId);

    return rows
      .map((r) => {
        const total = r.inputTokens + r.outputTokens;
        return {
          agentId: r.agentId ?? "(unattributed)",
          calls: r.calls,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          totalTokens: total,
          averagePerCall: r.calls > 0 ? Math.round(total / r.calls) : 0,
        };
      })
      .sort((a, b) => b.totalTokens - a.totalTokens);
  }
}

/**
 * Budget that never runs out — the default wherever one isn't wired in
 * (tests, demos), so gating is opt-in and nothing silently stops working.
 */
export class UnlimitedTokenBudget implements TokenBudget {
  async record(): Promise<void> {}
  async byAgent(): Promise<AgentTokenSpend[]> {
    return [];
  }
  async state(): Promise<BudgetState> {
    return { usedToday: 0, budget: Infinity, remaining: Infinity, exhausted: false };
  }
}
