# Task board

Owner of each row edits only their directories. The lead integrates and commits. Status: `todo` · `doing` · `review` · `done` · `blocked (reason)`.

| # | Task | Owner (model) | Directories | Status |
|---|---|---|---|---|
| 1 | CLAUDE.md, agent definitions, ADR 0001, task board | lead (opus) | root, `.claude/`, `docs/` | done |
| 2 | Contracts: workflow, entities, approval, publish, metrics, cost, audit, adapters, canonical hash | lead (opus) | `packages/contracts` | done |
| 3 | DB schema, guard triggers, lease queue, settings | lead (opus) | `packages/db` | done |
| 4 | Approval signing + gate tests | lead (opus) | `packages/contracts`, `tests/` | done |
| 5 | Evidence gates, claim ledger rules, creative rules, adversarial tests | evidence (opus) | `packages/content` | done |
| 6 | Mock publisher/insights + reconciliation; ffprobe spec validation; TTS adapter interface | adapters (sonnet) | `packages/instagram`, `packages/media` | done |
| 7 | Studio skeleton: owner auth, topics, evidence, preview, approve/reject/revoke, pause, spending stop | studio (sonnet) | `apps/studio` | review (owner click-through pending) |
| 8 | Instagram capability record; TTS candidates + audition script | research (sonnet) | `docs/research/` | review (official pages blocked by proxy; facts unverified) |
| 9 | Worker + mock vertical slice | lead (opus) | `apps/worker` | done |
| 10 | Owner input request (bundled) | lead | — | done |

## Next (day 2–3)

| # | Task | Owner (model) | Status |
|---|---|---|---|
| 11 | Re-verify capability record against official Meta pages (from a network that can reach them) | research (sonnet) | todo |
| 12 | Real-Postgres race test (two worker processes, `SKIP LOCKED`) under `tests/pg/` | lead (opus) | todo |
| 13 | Corrections workflow: flag → auto-pause affected queue → correction package | evidence (opus) + lead | todo |
| 14 | Render manifest + `renders`/`assets` rows from the media pipeline | adapters (sonnet) | todo |
| 15 | Studio: spending-cap editor (owner only), cost totals, insights by matching age | studio (sonnet) | todo |
| 16 | Speed up PGlite tests (migrate once, clone data dir) | lead | todo |

## Blocked on the owner

- Launch language, audience geography, accent.
- Instagram account type; Meta developer app readiness.
- TTS provider access; spending cap.
- Deployment target.
- Remotion licence eligibility.
