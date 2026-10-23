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
| Render | 3 Remotion templates, burned-in captions + SRT/VTT, ProRes 4K master, H.264 delivery, cover, manifest; recorded as renders/assets | render tests (gated) + fixture render; `LIFE_SLICE_RENDER=<template> pnpm slice` |
| Instagram | Mock publisher/insights, live publisher/insights with resumable upload, reconciliation, connect helpers, token refresh | fake-fetch tests only |
| Worker | Publish state machine with gate re-check and reconciliation, scheduler, insights, draft pipeline, live gate | worker tests |
| Studio | Login, episodes, evidence, approve/reject/revoke, settings/spending, voice, insights, corrections, Instagram connect, jobs, experiments, audit | typecheck + build + unit tests; browser click-through against Postgres (login, pause/resume, correction run + close, experiment, logout: 17/17 pass; Approve deliberately not clicked) |
| Security review | 3 high, 8 medium, 7 low findings fixed (publish mode binding, no republish after a media ID, upload of the hashed bytes, reconciliation, SSRF, billed-failure costs, restore, voice binding, rechecks, OAuth cookie, account swap) | worker/db/contracts/reasoning tests; real-Postgres race tests |
| CI | Linux + Windows tests, Postgres races, studio build | GitHub Actions |

## Open

| # | Task | Owner (model) | Status |
|---|---|---|---|
| R3 | Check safe zones and cover crop against the current Instagram app on a phone | owner + lead | todo |
| R5 | Live cover: owner chose the video's first frame; render extracts frame 0, live sends `thumb_offset=0` | lead | done |
| R4 | Storage lifecycle: ProRes masters are ~50 GB per hour of video (626 MB for 46 s) — decide archive/cleanup | owner | todo |
| V1 | Re-verify Instagram capability record and TTS facts against official pages | research (sonnet) | blocked (network policy blocks vendor sites here) |
| P1 | First real sourced pilot: LU-TECH-002 (Android location choices) — verified after 8 independent review rounds (on-screen text included); preview rendered; see docs/review-packages/LU-TECH-002.md | lead + evidence (opus) | review (needs owner voice + approval) |
| P2 | More pilots | lead + owner | blocked (only developer.android.com was reachable from this cloud box; other sources need the owner's machine or `pnpm draft`) |

## Blocked on the owner

- Voice: sign up (ElevenLabs, Cartesia), add keys, run `pnpm audition --confirm-spend`, pick the narrator in the studio.
- Spending cap: set $100/month in Studio → Settings → Spending (paid calls are refused until then).
- Claude API key for drafting (`ANTHROPIC_API_KEY`) if you want automated drafts.
- Instagram: confirm Creator account, create the Meta app (capability record §11), paste the token in the studio.
- Live publishing switch (`LIVE_PUBLISHING_AUTHORIZED=yes`) after the capability record is verified; use a new `INSTAGRAM_ACCOUNT_ID` for live (runbook).
- Click through the studio once on your machine and report anything broken.
