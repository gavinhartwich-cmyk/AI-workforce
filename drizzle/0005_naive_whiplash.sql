ALTER TABLE "groq_token_events" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "groq_token_events" ADD COLUMN "run_id" uuid;