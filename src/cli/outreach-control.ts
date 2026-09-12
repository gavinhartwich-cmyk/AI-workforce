/**
 * The intervention lever (Gavin, 2026-09-XX: "I can still see and
 * intervene if needed"). Operates against real AGENT_DATABASE_URL —
 * a genuine operational tool, not a demo. Every autonomous send checks
 * this same state before sending (src/outreach/send-guard.ts).
 *
 * Usage:
 *   npm run outreach:control -- status
 *   npm run outreach:control -- pause "investigating a bounce spike"
 *   npm run outreach:control -- resume
 *   npm run outreach:control -- suppress prospect@example.com "asked to stop"
 */
import "dotenv/config";
import { PostgresOutreachControlStore } from "../outreach/outreach-control-store.js";
import { PostgresOptOutStore } from "../outreach/opt-out-store.js";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const control = new PostgresOutreachControlStore();
  const optOuts = new PostgresOptOutStore();

  switch (command) {
    case "pause": {
      const reason = args.join(" ") || "paused via CLI";
      await control.pause(reason);
      console.log(`Sending PAUSED: ${reason}`);
      break;
    }
    case "resume":
      await control.resume();
      console.log("Sending RESUMED.");
      break;
    case "status": {
      const state = await control.getState();
      console.log(state.sendingPaused ? `PAUSED — ${state.pausedReason}` : "RUNNING");
      break;
    }
    case "suppress": {
      const [email, ...reasonParts] = args;
      if (!email) throw new Error("Usage: suppress <email> [reason]");
      await optOuts.suppress(email, reasonParts.join(" ") || "manually suppressed");
      console.log(`Suppressed ${email} — no future send will ever go to this address.`);
      break;
    }
    default:
      console.log("Usage: outreach:control -- <pause <reason>|resume|status|suppress <email> [reason]>");
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
