CREATE TYPE "public"."agent_run_status" AS ENUM('succeeded', 'failed', 'denied');--> statement-breakpoint
CREATE TYPE "public"."experiment_status" AS ENUM('running', 'stopped', 'concluded');--> statement-breakpoint
CREATE TYPE "public"."goal_priority" AS ENUM('low', 'normal', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('NOT_STARTED', 'ON_TRACK', 'AT_RISK', 'BEHIND', 'CRITICAL', 'ACHIEVED', 'FAILED');--> statement-breakpoint
CREATE TABLE "agent_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool" text NOT NULL,
	"min_autonomy_level" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"agent_version" text NOT NULL,
	"model" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "agent_run_status" NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "experiment_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"directive" text NOT NULL,
	"weight" numeric(5, 2) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"min_sample_size_per_variant" integer NOT NULL,
	"status" "experiment_status" DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"observation" text NOT NULL,
	"diagnosis" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_action" text NOT NULL,
	"reason" text NOT NULL,
	"expected_outcome" text NOT NULL,
	"actual_outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_control" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"sending_paused" boolean DEFAULT false NOT NULL,
	"paused_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"current_value" numeric(14, 2) NOT NULL,
	"expected_by_now" numeric(14, 2) NOT NULL,
	"current_pace" numeric(14, 4) NOT NULL,
	"required_future_pace" numeric(14, 4) NOT NULL,
	"projected_final" numeric(14, 2) NOT NULL,
	"probability" integer NOT NULL,
	"status" "goal_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric" text NOT NULL,
	"target" numeric(14, 2) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"priority" "goal_priority" DEFAULT 'normal' NOT NULL,
	"constraints" jsonb,
	"status" "goal_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_kpi_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"value" numeric(14, 2),
	"confidence" numeric(3, 2) NOT NULL,
	"data_source" text NOT NULL,
	"note" text,
	"as_of" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressed_contacts" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"suppressed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_decisions" ADD CONSTRAINT "manager_decisions_goal_id_sales_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."sales_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_forecasts" ADD CONSTRAINT "sales_forecasts_goal_id_sales_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."sales_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_kpi_snapshots" ADD CONSTRAINT "sales_kpi_snapshots_goal_id_sales_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."sales_goals"("id") ON DELETE cascade ON UPDATE no action;