CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"release_package_id" text NOT NULL,
	"approver_kind" text NOT NULL,
	"approver_id" text NOT NULL,
	"signed_approval" jsonb NOT NULL,
	"key_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "approvals_owner_only" CHECK ("approvals"."approver_kind" = 'owner'),
	CONSTRAINT "approvals_revocation_reason" CHECK (("approvals"."revoked_at" is null) = ("approvals"."revoked_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"uri" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" bigint NOT NULL,
	"mime_type" text NOT NULL,
	"license_id" text,
	"source" text NOT NULL,
	"native_resolution" text,
	"upscale_method" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" jsonb NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"details" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"source_id" text NOT NULL,
	"stance" text NOT NULL,
	"supporting_passage" text NOT NULL,
	"locator" text NOT NULL,
	"study_type" text,
	"population" text,
	"limitations" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"text" text NOT NULL,
	"locations" jsonb NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"risk_tier" text NOT NULL,
	"time_sensitivity" text NOT NULL,
	"fresh_until" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"permitted_wording" text,
	"limitations" text,
	"is_numeric" boolean NOT NULL,
	"is_causal" boolean NOT NULL,
	"is_consequential" boolean NOT NULL,
	"single_origin_justification" text,
	CONSTRAINT "claims_status" CHECK ("claims"."status" in ('supported','supported_with_limits','unresolved','rejected')),
	CONSTRAINT "claims_rejected_reason" CHECK ("claims"."status" <> 'rejected' or "claims"."status_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "cost_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"units" double precision NOT NULL,
	"unit_type" text NOT NULL,
	"amount_micro_usd" bigint NOT NULL,
	"estimated" boolean NOT NULL,
	"source" text NOT NULL,
	"episode_id" text,
	"job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_nonnegative" CHECK ("cost_events"."amount_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "episode_links" (
	"episode_id" text PRIMARY KEY NOT NULL,
	"parent_question" text,
	"resolved_question" text NOT NULL,
	"next_question" text,
	"related_episode_id" text,
	"relationship_reason" text,
	"ending_references_related" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_transitions" (
	"id" text PRIMARY KEY NOT NULL,
	"episode_id" text NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"reason" text,
	"actor" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"episode_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"content_sha256" text NOT NULL,
	"claim_ledger_sha256" text NOT NULL,
	"supersedes_version_id" text,
	"created_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"topic_id" text NOT NULL,
	"format" text NOT NULL,
	"state" text NOT NULL,
	"state_reason" text,
	"held_from" text,
	"current_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episodes_code_unique" UNIQUE("code"),
	CONSTRAINT "episodes_hold_reason" CHECK ("episodes"."state" not in ('blocked','failed','cancelled') or ("episodes"."state_reason" is not null and length(trim("episodes"."state_reason")) > 0)),
	CONSTRAINT "episodes_held_from" CHECK ("episodes"."state" not in ('blocked','failed','cancelled') or "episodes"."held_from" is not null)
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"hypothesis" text NOT NULL,
	"change" text NOT NULL,
	"evaluation_window" text NOT NULL,
	"result" text,
	"decision" text,
	"rollback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_media" (
	"id" text PRIMARY KEY NOT NULL,
	"publish_job_id" text NOT NULL,
	"account_id" text NOT NULL,
	"remote_media_id" text NOT NULL,
	"permalink" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "instagram_media_publish_job_id_unique" UNIQUE("publish_job_id"),
	CONSTRAINT "instagram_media_remote_media_id_unique" UNIQUE("remote_media_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "jobs_state" CHECK ("jobs"."state" in ('queued','leased','succeeded','failed','cancelled')),
	CONSTRAINT "jobs_lease" CHECK ("jobs"."state" <> 'leased' or ("jobs"."lease_owner" is not null and "jobs"."lease_expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"scope" text NOT NULL,
	"terms_url" text,
	"attribution" text,
	"receipt_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_raw_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"instagram_media_id" text,
	"source" text NOT NULL,
	"api_version" text NOT NULL,
	"body" jsonb NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"account_id" text NOT NULL,
	"instagram_media_id" text,
	"metric" text NOT NULL,
	"definition" text NOT NULL,
	"unit" text NOT NULL,
	"window" text NOT NULL,
	"media_age_sec" integer,
	"api_version" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"value" double precision,
	"unavailability_reason" text,
	"source" text NOT NULL,
	"raw_response_id" text,
	CONSTRAINT "metric_null_xor_reason" CHECK (("metric_snapshots"."value" is null) <> ("metric_snapshots"."unavailability_reason" is null)),
	CONSTRAINT "metric_nonnegative" CHECK ("metric_snapshots"."value" is null or "metric_snapshots"."value" >= 0),
	CONSTRAINT "metric_source" CHECK ("metric_snapshots"."source" in ('mock','manual_import','live')),
	CONSTRAINT "metric_scope" CHECK (("metric_snapshots"."scope" = 'media') = ("metric_snapshots"."instagram_media_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" text PRIMARY KEY NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owners_singleton_unique" UNIQUE("singleton"),
	CONSTRAINT "owners_singleton" CHECK ("owners"."singleton")
);
--> statement-breakpoint
CREATE TABLE "publish_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"release_package_id" text NOT NULL,
	"approval_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"account_id" text NOT NULL,
	"adapter_mode" text NOT NULL,
	"state" text NOT NULL,
	"state_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"container_id" text,
	"container_created_at" timestamp with time zone,
	"remote_media_id" text,
	"permalink" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publish_jobs_mode" CHECK ("publish_jobs"."adapter_mode" in ('mock','live')),
	CONSTRAINT "publish_jobs_reason" CHECK ("publish_jobs"."state" not in ('failed','cancelled','needs_reconciliation','retry_wait') or "publish_jobs"."state_reason" is not null),
	CONSTRAINT "publish_jobs_published" CHECK ("publish_jobs"."state" <> 'published' or ("publish_jobs"."remote_media_id" is not null and "publish_jobs"."permalink" is not null))
);
--> statement-breakpoint
CREATE TABLE "approval_rejections" (
	"id" text PRIMARY KEY NOT NULL,
	"release_package_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"feedback" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"episode_id" text NOT NULL,
	"episode_version_id" text NOT NULL,
	"content" jsonb NOT NULL,
	"package_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_packages_package_sha256_unique" UNIQUE("package_sha256")
);
--> statement-breakpoint
CREATE TABLE "renders" (
	"id" text PRIMARY KEY NOT NULL,
	"episode_version_id" text NOT NULL,
	"kind" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"output_asset_id" text,
	"validation" jsonb,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_records" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text,
	"episode_version_id" text,
	"reviewer_kind" text NOT NULL,
	"reviewer" text NOT NULL,
	"verdict" text NOT NULL,
	"notes" text NOT NULL,
	"document_ref" text,
	"authorized_display_wording" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"publishing_paused" boolean DEFAULT false NOT NULL,
	"paused_reason" text,
	"spending_stopped" boolean DEFAULT false NOT NULL,
	"spending_cap_micro_usd" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" jsonb,
	CONSTRAINT "settings_singleton" CHECK ("settings"."singleton"),
	CONSTRAINT "settings_pause_reason" CHECK (not "settings"."publishing_paused" or "settings"."paused_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"doi" text,
	"title" text NOT NULL,
	"authors" jsonb NOT NULL,
	"institution" text,
	"source_type" text NOT NULL,
	"published_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone NOT NULL,
	"origin_id" text NOT NULL,
	"available" boolean NOT NULL,
	"retraction_checked_at" timestamp with time zone,
	"retracted" boolean NOT NULL,
	"correction_note" text,
	"content_sha256" text
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" text PRIMARY KEY NOT NULL,
	"pillar" text NOT NULL,
	"title" text NOT NULL,
	"question" text NOT NULL,
	"risk_tier" text NOT NULL,
	"intent" jsonb NOT NULL,
	"is_fixture" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_profiles" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"approved_by_owner_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_profiles_id_version_pk" PRIMARY KEY("id","version")
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_release_package_id_release_packages_id_fk" FOREIGN KEY ("release_package_id") REFERENCES "public"."release_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_id_owners_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_links" ADD CONSTRAINT "episode_links_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_links" ADD CONSTRAINT "episode_links_related_episode_id_episodes_id_fk" FOREIGN KEY ("related_episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_transitions" ADD CONSTRAINT "episode_transitions_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_versions" ADD CONSTRAINT "episode_versions_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_media" ADD CONSTRAINT "instagram_media_publish_job_id_publish_jobs_id_fk" FOREIGN KEY ("publish_job_id") REFERENCES "public"."publish_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_raw_responses" ADD CONSTRAINT "metric_raw_responses_instagram_media_id_instagram_media_id_fk" FOREIGN KEY ("instagram_media_id") REFERENCES "public"."instagram_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_instagram_media_id_instagram_media_id_fk" FOREIGN KEY ("instagram_media_id") REFERENCES "public"."instagram_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_raw_response_id_metric_raw_responses_id_fk" FOREIGN KEY ("raw_response_id") REFERENCES "public"."metric_raw_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_release_package_id_release_packages_id_fk" FOREIGN KEY ("release_package_id") REFERENCES "public"."release_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rejections" ADD CONSTRAINT "approval_rejections_release_package_id_release_packages_id_fk" FOREIGN KEY ("release_package_id") REFERENCES "public"."release_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rejections" ADD CONSTRAINT "approval_rejections_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_packages" ADD CONSTRAINT "release_packages_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_packages" ADD CONSTRAINT "release_packages_episode_version_id_episode_versions_id_fk" FOREIGN KEY ("episode_version_id") REFERENCES "public"."episode_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_episode_version_id_episode_versions_id_fk" FOREIGN KEY ("episode_version_id") REFERENCES "public"."episode_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_output_asset_id_assets_id_fk" FOREIGN KEY ("output_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_records" ADD CONSTRAINT "review_records_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_package" ON "approvals" USING btree ("release_package_id");--> statement-breakpoint
CREATE INDEX "audit_entity" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_versions_number" ON "episode_versions" USING btree ("episode_id","version_number");--> statement-breakpoint
CREATE INDEX "jobs_ready" ON "jobs" USING btree ("state","run_at");--> statement-breakpoint
CREATE INDEX "metric_snapshots_media" ON "metric_snapshots" USING btree ("instagram_media_id","metric","window");--> statement-breakpoint
CREATE UNIQUE INDEX "publish_jobs_one_live_per_package" ON "publish_jobs" USING btree ("release_package_id") WHERE "publish_jobs"."state" not in ('failed','cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX "publish_jobs_one_live_per_episode_account" ON "publish_jobs" USING btree ("episode_id","account_id") WHERE "publish_jobs"."state" not in ('failed','cancelled');