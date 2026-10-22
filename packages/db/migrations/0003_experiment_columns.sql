ALTER TABLE "experiments" ADD COLUMN "variable" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "baseline_template" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "evidence_summary" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "decided_at" timestamp with time zone;