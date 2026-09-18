CREATE TABLE "groq_token_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manager_escalations" ADD COLUMN "execution_attempts" integer DEFAULT 0 NOT NULL;