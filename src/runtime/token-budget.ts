import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { groqTokenUsage } from "../db/schema.js";
import type { ModelUsage } from "./types.js";

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

/** YYYY-MM-DD in UTC — the window Groq's own daily cap tracks. */
export function utcDateKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export type BudgetState = {
  usedToday: number;
  budget: number;
  remaining: number;
  exhausted: boolean;
};

export interface TokenBudget {
  /** Add a completed call's tokens to today's total. */
  record(usage: ModelUsage, at?: Date): Promise<void>;
  /** How much of the agents' daily budget is left. */
  state(at?: Date): Promise<BudgetState>;
}

export class PostgresTokenBudget implements TokenBudget {
  constructor(private budget: number = agentDailyTokenBudget()) {}

  async record(usage: ModelUsage, at: Date = new Date()): Promise<void> {
    const total = usage.inputTokens + usage.outputTokens;
    if (total <= 0) return;

    const db = getDb();
    // Upsert-and-add in one statement: several agents can finish calls
    // concurrently within a cycle, and read-then-write would lose updates.
    await db
      .insert(groqTokenUsage)
      .values({
        usageDate: utcDateKey(at),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: groqTokenUsage.usageDate,
        set: {
          inputTokens: sql`${groqTokenUsage.inputTokens} + ${usage.inputTokens}`,
          outputTokens: sql`${groqTokenUsage.outputTokens} + ${usage.outputTokens}`,
          updatedAt: at,
        },
      });
  }

  async state(at: Date = new Date()): Promise<BudgetState> {
    const db = getDb();
    const row = await db.query.groqTokenUsage.findFirst({
      where: eq(groqTokenUsage.usageDate, utcDateKey(at)),
    });
    const usedToday = row ? row.inputTokens + row.outputTokens : 0;
    const remaining = Math.max(0, this.budget - usedToday);
    return { usedToday, budget: this.budget, remaining, exhausted: remaining <= 0 };
  }
}

/**
 * Budget that never runs out — the default wherever one isn't wired in
 * (tests, demos), so gating is opt-in and nothing silently stops working.
 */
export class UnlimitedTokenBudget implements TokenBudget {
  async record(): Promise<void> {}
  async state(): Promise<BudgetState> {
    return { usedToday: 0, budget: Infinity, remaining: Infinity, exhausted: false };
  }
}
