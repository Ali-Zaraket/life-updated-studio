# Session notes — Day 1 (2026-10-21/22)

Working notes from the lead session, kept so a cloud continuation has the same context. Decisions here are proposals until recorded as an ADR under `docs/decisions/`.

## Environment found on the owner's Windows machine (2026-10-21)

- Node 24.20.0, npm 11.6.2, pnpm 10.14.0, git 2.50.1, Claude Code 2.1.283.
- Docker 28.4 installed but the daemon was not running; no FFmpeg/ffprobe; no psql; no `gh` CLI.
- Model routing resolved for this provider: Opus = `claude-opus-5-5` (lead session), Sonnet = `claude-sonnet-5-5` (alias `sonnet`; **verified 2026-10-22** from the research agent's self-report).

## Version pins checked on npm (2026-10-21)

| Package | Pin | License | Note |
|---|---|---|---|
| typescript | 5.9.3 | Apache-2.0 | 7.0.2 (native compiler) is `latest`; held back for Next.js / drizzle-kit tooling compatibility |
| zod | 4.6.7 | MIT | |
| drizzle-orm / drizzle-kit | 0.45.4 / 0.31.11 | Apache-2.0 / MIT | |
| @electric-sql/pglite | 0.5.11 | Apache-2.0 | In-process Postgres for deterministic tests |
| pg | 8.23.1 | MIT | Runtime driver for real Postgres |
| postgres (Docker image) | 17-alpine | PostgreSQL licence | Local database via Docker Compose (replaced embedded-postgres) |
| vitest | 5.0.5 | MIT | Node ^22.12 / ^24 |
| tsx | 4.23.15 | MIT | |
| next / react / react-dom | 16.4.2 / 19.3.1 / 19.3.1 | MIT | |
| remotion | 4.0.537 | Remotion License | **Not free for every company size** — check the owner's eligibility (individual / small-company tier vs company license) before adopting. Not installed yet. |

## Proposed decisions (not yet implemented)

1. **Database:** real Postgres in deployment and local dev (Docker Compose); PGlite in-memory for CI tests so tests need no daemon. Drizzle schema shared by both drivers.
2. **Job queue:** a small Postgres-backed lease queue (`FOR UPDATE SKIP LOCKED`, lease expiry, bounded retries with backoff) inside `packages/db`, because it runs identically on PGlite in tests. Revisit pg-boss if needs grow. Publish jobs keep their own domain state for reconciliation.
3. **Approvals cannot be minted by agents:** the studio signs each approval with an Ed25519 private key that only the studio process holds; the worker holds only the public key and verifies the signature plus the exact package binding (episode version hash, delivery media hash, cover hash, caption hash, disclosure, account, publish window) immediately before publishing. DB triggers make episode versions immutable and allow approvals to change only by revocation.
4. **Reconciliation key:** each caption carries the episode identifier (e.g. `LU-TECH-001`), which doubles as the series ID and the marker used to reconcile an ambiguous publish timeout against recent remote media.
5. **Owner auth (local):** a passphrase hash in local env + signed session cookie; swap to managed auth for deployment.

## Workstream plan

- Lead (Opus): contracts, DB schema + immutability triggers, approval signing/gate + tests, worker, vertical slice, integration.
- Evidence (Opus agent): `packages/content` — claim ledger, risk gates, freshness, origin independence, creative rules (no engagement begging, promise resolved before twist, linked episode live), adversarial tests.
- Adapters (Sonnet agent): `packages/instagram` mock publisher/insights + reconciliation; `packages/media` ffprobe-spec validation + TTS adapter interface.
- Studio (Sonnet agent): `apps/studio` owner UI on top of `packages/db`.
- Research (Sonnet agent): `docs/research/instagram-capability-record.md` and `docs/research/tts-candidates.md`. First attempt was stopped before writing anything; restart it.

Only the lead edits root manifests, the lockfile, and migrations.

## Day 1 results (cloud session, 2026-10-22)

- Linux cloud box: Node 22.22, pnpm 10.14, ffmpeg/ffprobe present, Postgres binaries via embedded-postgres (runs as a `postgres` user when the process is root).
- Proposed decisions 1–5 above are implemented and recorded in ADR 0001.
- `pnpm test`: 241 tests across 11 files pass on PGlite; every package typechecks; studio `next build` compiles.
- `pnpm slice` (in-memory) runs the full MOCK pipeline including a SIMULATED owner approval with an ephemeral key. With `DATABASE_URL` it stops at `awaiting_user_approval` for the owner to approve in the studio.
- Research agent could not reach developers.facebook.com or TTS vendor sites (proxy 403). Both research records are built from search summaries and mark most facts `unverified`/`conflict`. Do not implement live calls from them until re-verified.
- Bug the gates caught: Postgres timestamps were not ISO-8601; fixed with an ISO timestamp column type (no migration change).

## Day 1, later (cloud session, 2026-10-22)

- Owner decisions recorded in ADR 0002 (US English, Lebanon-first, Creator account, ElevenLabs/Cartesia auditions — Google skipped for its $30 prepayment, $100/month cap with $50 warning, localhost, Remotion free licence as an individual — verified from the licence file in the Remotion repository).
- Remotion 4.0.537 render on 4 cores: 3-second samples ~35 s each; a 45.7 s episode ~7 min 47 s (master 412 s). ProRes 422 `standard` master 626 MB; delivery 6.9 MB; loudness -13.9 LUFS. Set `REMOTION_BROWSER_EXECUTABLE` where a browser is preinstalled; otherwise Remotion downloads its headless shell once.
- Safe-zone insets (top 0.12, bottom 0.22, left 0.07, right 0.13) are estimates until checked on a phone.
- Anthropic SDK 1.1.0 for drafting/verification: Opus 5.5 ($4/$20 per MTok), Sonnet 5.5 ($2/$10), refusal fallback `fallbacks: "default"` enabled.
- Bundled Postgres has no pg_dump and the system pg_dump (16) cannot dump a v18 server, so backups are a portable JSON export with per-table hashes.
- CI run #14 green on Linux, Windows, real-Postgres races and the studio build.
