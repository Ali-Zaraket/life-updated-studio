CREATE TABLE "corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"plan_sha256" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"flagged_by" jsonb NOT NULL,
	"resolution" text,
	"resolved_by" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "corrections_status" CHECK ("corrections"."status" in ('open','resolved','dismissed')),
	CONSTRAINT "corrections_resolution" CHECK ("corrections"."status" = 'open' or ("corrections"."resolution" is not null and "corrections"."resolved_at" is not null and "corrections"."resolved_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "instagram_credentials" (
	"account_id" text PRIMARY KEY NOT NULL,
	"ig_user_id" text NOT NULL,
	"username" text,
	"token_sealed" text NOT NULL,
	"key_id" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
