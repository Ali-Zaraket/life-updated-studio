# ADR 0001 — Minimum architecture and frozen first-workstream interfaces

- **Status:** accepted (lead), 2026-10-22
- **Context:** `docs/BRIEF.md` §8–10; environment notes in `docs/SESSION-NOTES.md`.

## Decisions

1. **TypeScript pnpm monorepo** with the brief's layout: `apps/studio` (Next.js 16), `apps/worker`, `packages/{contracts,db,content,media,instagram}`. Node ≥ 22.12. Pins are recorded in `docs/SESSION-NOTES.md`; TypeScript stays on 5.9 for tooling compatibility.
2. **Contracts first.** `packages/contracts` (zod 4) defines every shared shape: workflow states and transitions, episode/claim/evidence entities, release package, signed approval, publish job, metric snapshot, cost and audit events, and the adapter interfaces. Workstreams code against these; changes go through the lead.
3. **Database.** PostgreSQL in deployment and local dev (Docker Compose `db` service, Postgres 17, UTF-8; replaced embedded-postgres on 2026-10-23 after its Windows initdb crashed and defaulted to WIN1252); PGlite in-process for tests. One Drizzle schema serves both. Guards that must hold regardless of application bugs live in the database:
   - `episode_versions`, `release_packages`, `audit_events`: immutable (UPDATE/DELETE raise).
   - `approvals`: no DELETE; UPDATE only sets the revocation columns once.
   - `approvals.approver_kind = 'owner'` CHECK plus FK to the single-row `owners` table.
   - `metric_snapshots`: CHECK that `value IS NULL` exactly when `unavailability_reason IS NOT NULL`.
   - Blocked/failed/cancelled rows must carry a reason (CHECK).
   - Partial unique index: at most one live (not cancelled / not permanently failed) publish job per release package, and one per episode+account.
4. **Job queue.** A small Postgres lease queue in `packages/db` (`FOR UPDATE SKIP LOCKED`, lease expiry, bounded retries with exponential backoff, cancellation). It runs identically on PGlite. Publish jobs keep their own domain state machine for reconciliation; the queue only schedules work. Revisit pg-boss if needs grow.
5. **Approvals are signatures, not rows.** The studio signs a canonical JSON approval payload with an Ed25519 private key held only by the studio process. The worker holds only public keys (by `keyId`). Immediately before publishing the worker checks: signature, `approver.kind = owner`, package binding (version hash, media/cover/caption hashes, disclosure, account), approval expiry, publish window, revocation, global pause, spending stop, and the evidence gate. A row in the DB without a valid signature is worthless, so DB write access alone cannot mint an approval.
6. **Hashing.** `sha256` over a canonical JSON encoding (sorted keys, no insignificant whitespace, no `undefined`, finite numbers only). The release package hash covers every field the owner sees.
7. **Reconciliation key.** Each caption carries the episode code (e.g. `LU-TECH-001`), used to match an ambiguous publish timeout to recent remote media before any retry.
8. **Metrics.** `null` + `unavailability_reason` for anything not returned; `source` is `mock | manual_import | live` on every snapshot.
9. **Owner auth (local).** Passphrase hash in local env + signed, httpOnly session cookie. Managed auth at deployment (decision pending deployment target).
10. **Model routing.** Opus `claude-opus-5-5` (lead session) and Sonnet `claude-sonnet-5-5` (verified from an agent self-report, 2026-10-22). Opus for the lead, evidence workstream and security/race reviews; Sonnet `claude-sonnet-5-5` for studio, adapters, research and routine work. Agents are defined in `.claude/agents/` with explicit `model`.

## Consequences

- Tests need no daemon or network; the full guard set is exercised on PGlite.
- A compromised agent or worker cannot publish without the studio key; key custody becomes the main operational secret (documented in the runbook later).
- Remotion is adopted (free licence: the owner is an individual; verified from the licence file in the Remotion repository, see ADR 0002).
