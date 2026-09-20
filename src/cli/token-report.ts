/**
 * Token spend per agent over the rolling 24-hour window.
 *
 * The question this exists to answer is "which agent costs what", which
 * nothing could answer before: agent_runs knew which agent ran,
 * groq_token_events knew how many tokens were spent, and the two shared no
 * key. Call counts are not a substitute — research_agent sends scraped page
 * text at a 2048-token ceiling while qualification_agent sends compact
 * structured input, so equal call counts can mean very different spend.
 *
 * The number that decides whether merging two agents into one call is worth
 * doing is TOKENS PER CALL, not calls. Read that column first.
 *
 * Run with: npm run tokens
 */
import "dotenv/config";

import { PostgresTokenBudget, ROLLING_WINDOW_MS } from "../runtime/token-budget.js";

function bar(value: number, max: number, width = 28): string {
  if (max <= 0) return "";
  return "█".repeat(Math.max(1, Math.round((value / max) * width)));
}

function pad(value: string | number, width: number, left = false): string {
  const s = String(value);
  return left ? s.padStart(width) : s.padEnd(width);
}

async function main() {
  if (!process.env.AGENT_DATABASE_URL) {
    console.error("AGENT_DATABASE_URL is not set. See .env.example.");
    process.exit(1);
  }

  const budget = new PostgresTokenBudget();
  const [state, rows] = await Promise.all([budget.state(), budget.byAgent()]);

  const hours = ROLLING_WINDOW_MS / 3_600_000;
  console.log(`\nGroq token spend — rolling ${hours}h (the window Groq's own cap measures)\n`);

  if (rows.length === 0) {
    console.log("  No token events recorded yet in this window.\n");
  } else {
    const max = rows[0].totalTokens;
    console.log(
      `  ${pad("AGENT", 28)}${pad("TOKENS", 10, true)}${pad("CALLS", 8, true)}${pad("PER CALL", 11, true)}  SHARE`
    );
    console.log("  " + "─".repeat(76));
    for (const r of rows) {
      console.log(
        `  ${pad(r.agentId, 28)}${pad(r.totalTokens.toLocaleString(), 10, true)}${pad(r.calls, 8, true)}${pad(
          r.averagePerCall.toLocaleString(),
          11,
          true
        )}  ${bar(r.totalTokens, max)}`
      );
    }
  }

  const pct = state.budget > 0 ? Math.round((state.usedToday / state.budget) * 100) : 0;
  console.log(
    `\n  Agents' share: ${state.usedToday.toLocaleString()} / ${state.budget.toLocaleString()} (${pct}%)` +
      (state.exhausted
        ? " — spent; discovery skips until it frees up."
        : ` — ${state.remaining.toLocaleString()} left.`)
  );
  // Worth stating outright: this ledger only sees calls made through this
  // repo. hartwich-os's Sales Manager chat spends from the same Groq
  // organisation, so Groq's own counter always reads higher than this one.
  console.log("  Counts this repo's calls only — the Sales Manager chat shares the same Groq org.\n");
}

main()
  .catch((err) => {
    console.error("Failed to read token spend:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
