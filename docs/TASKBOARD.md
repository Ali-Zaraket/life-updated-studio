# Task board

Owner of each row edits only their directories. The lead integrates and commits. Status: `todo` · `doing` · `review` · `done` · `blocked (reason)`.

| # | Task | Owner (model) | Directories | Status |
|---|---|---|---|---|
| 1 | CLAUDE.md, agent definitions, ADR 0001, task board | lead (opus) | root, `.claude/`, `docs/` | done |
| 2 | Contracts: workflow, entities, approval, publish, metrics, cost, audit, adapters, canonical hash | lead (opus) | `packages/contracts` | doing |
| 3 | DB schema, guard triggers, lease queue, settings | lead (opus) | `packages/db` | todo |
| 4 | Approval signing + gate tests | lead (opus) | `packages/contracts`, `tests/` | todo |
| 5 | Evidence gates, claim ledger rules, creative rules, adversarial tests | evidence (opus) | `packages/content` | todo |
| 6 | Mock publisher/insights + reconciliation; ffprobe spec validation; TTS adapter interface | adapters (sonnet) | `packages/instagram`, `packages/media` | todo |
| 7 | Studio skeleton: owner auth, topics, evidence, preview, approve/reject/revoke, pause, spending stop | studio (sonnet) | `apps/studio` | todo |
| 8 | Instagram capability record; TTS candidates + audition script | research (sonnet) | `docs/research/` | doing |
| 9 | Worker + mock vertical slice | lead (opus) | `apps/worker` | todo |
| 10 | Owner input request (bundled) | lead | — | todo |

## Blocked on the owner

- Launch language, audience geography, accent.
- Instagram account type; Meta developer app readiness.
- TTS provider access; spending cap.
- Deployment target.
- Remotion licence eligibility.
