# Task board

Owner of each row edits only their directories. The lead integrates and commits. Status: `todo` · `doing` · `review` · `done` · `blocked (reason)`.

## Built (day 1, 2026-10-22)

| Area | What exists | Evidence |
|---|---|---|
| Rules & coordination | CLAUDE.md, `.claude/agents/*`, ADR 0001 (architecture), ADR 0002 (owner decisions), runbook | docs/ |
| Contracts | Workflow + transitions, evidence entities, signed approvals + publish gate, publish jobs, null-not-zero metrics, adapters | contracts tests |
| Database | Schema, immutability/revocation/owner/metric triggers & checks, lease queue, settings, spending guard, sealed credentials, OAuth state, corrections, backup/restore | db tests + real-Postgres race tests |
| Evidence | Claim ledger gate, creative rules, corrections planner, labelled fixture | content tests |
| Reasoning | Claude drafting (Opus 5.5), independent check (Opus 5.5), claim extraction (Sonnet 5.5), budget wrapper | fake-fetch tests; `pnpm draft` |
| Media | ffprobe spec validation, loudness, TTS adapters (ElevenLabs, Google, Cartesia), audition runner | fake-fetch tests; `pnpm audition` |
| Render | Remotion templates, captions, master/delivery/cover | in progress (see row R1) |
| Instagram | Mock publisher/insights, live publisher/insights with resumable upload, reconciliation, connect helpers, token refresh | fake-fetch tests only |
| Worker | Publish state machine with gate re-check and reconciliation, scheduler, insights, draft pipeline, live gate | worker tests |
| Studio | Login, episodes, evidence, approve/reject/revoke, settings/spending, voice, insights, corrections, Instagram connect, jobs, experiments, audit | typecheck + build + unit tests; not clicked through |
| CI | Linux + Windows tests, Postgres races, studio build | GitHub Actions |

## Open

| # | Task | Owner (model) | Status |
|---|---|---|---|
| R1 | Render pipeline: 3 Remotion templates, burned-in captions, 4K master, delivery, cover, manifest | adapters (sonnet) | doing |
| R2 | Wire rendering into the worker/slice (replace the mock preview), record renders/assets rows | lead (opus) | todo (after R1) |
| V1 | Re-verify Instagram capability record and TTS facts against official pages | research (sonnet) | blocked (network policy blocks vendor sites here) |
| P1 | First real sourced pilot topics and scripts | evidence (opus) + owner | blocked (needs real source access + `ANTHROPIC_API_KEY` + spend confirmation) |
| E1 | Experiments: add baseline/variable columns (migration) | lead | todo (minor) |

## Blocked on the owner

- Voice: sign up (ElevenLabs, Cartesia), add keys, run `pnpm audition --confirm-spend`, pick the narrator in the studio.
- Spending cap: set $100/month in Studio → Settings → Spending (paid calls are refused until then).
- Claude API key for drafting (`ANTHROPIC_API_KEY`) if you want automated drafts.
- Instagram: confirm Creator account, create the Meta app (capability record §11), paste the token in the studio.
- Live publishing switch (`LIVE_PUBLISHING_AUTHORIZED=yes`) after the capability record is verified.
- Click through the studio once on your machine and report anything broken.
