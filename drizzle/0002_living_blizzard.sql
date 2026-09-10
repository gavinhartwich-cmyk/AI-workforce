CREATE TYPE "public"."escalation_status" AS ENUM('pending', 'approved', 'rejected', 'executed', 'failed');--> statement-breakpoint
CREATE TABLE "manager_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"proposed_change_percent" integer,
	"action" text NOT NULL,
	"diagnosis" text NOT NULL,
	"why_approval_required" text NOT NULL,
	"expected_impact" numeric,
	"risk" numeric,
	"status" "escalation_status" DEFAULT 'pending' NOT NULL,
	"execution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "manager_escalations" ADD CONSTRAINT "manager_escalations_goal_id_sales_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."sales_goals"("id") ON DELETE cascade ON UPDATE no action;