-- Guards that must hold even if application code is wrong. See ADR 0001 §3.

CREATE OR REPLACE FUNCTION life_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'life: % on % is not allowed (immutable record)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER episode_versions_immutable BEFORE UPDATE OR DELETE ON episode_versions
  FOR EACH ROW EXECUTE FUNCTION life_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER episode_versions_no_truncate BEFORE TRUNCATE ON episode_versions
  FOR EACH STATEMENT EXECUTE FUNCTION life_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER release_packages_immutable BEFORE UPDATE OR DELETE ON release_packages
  FOR EACH ROW EXECUTE FUNCTION life_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER release_packages_no_truncate BEFORE TRUNCATE ON release_packages
  FOR EACH STATEMENT EXECUTE FUNCTION life_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION life_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION life_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER approvals_no_delete BEFORE DELETE ON approvals
  FOR EACH ROW EXECUTE FUNCTION life_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER approvals_no_truncate BEFORE TRUNCATE ON approvals
  FOR EACH STATEMENT EXECUTE FUNCTION life_reject_mutation();
--> statement-breakpoint
-- An approval may change exactly once: from unrevoked to revoked, touching nothing else.
CREATE OR REPLACE FUNCTION life_approvals_revoke_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'life: approval % is already revoked', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.revoked_at IS NULL OR NEW.revoked_reason IS NULL THEN
    RAISE EXCEPTION 'life: approvals can only be changed by revocation' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'revoked_at' - 'revoked_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at' - 'revoked_reason') THEN
    RAISE EXCEPTION 'life: revocation may not alter other approval fields' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER approvals_revoke_only BEFORE UPDATE ON approvals
  FOR EACH ROW EXECUTE FUNCTION life_approvals_revoke_only();
--> statement-breakpoint
-- An episode's current version must belong to that episode.
CREATE OR REPLACE FUNCTION life_episode_current_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM episode_versions v WHERE v.id = NEW.current_version_id AND v.episode_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'life: current_version_id % does not belong to episode %', NEW.current_version_id, NEW.id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER episodes_current_version BEFORE INSERT OR UPDATE OF current_version_id ON episodes
  FOR EACH ROW EXECUTE FUNCTION life_episode_current_version();
--> statement-breakpoint
INSERT INTO settings (singleton, publishing_paused, spending_stopped, spending_cap_micro_usd) VALUES (true, false, false, NULL);
