# Runbook (localhost)

Everything runs on your machine. Nothing reaches Instagram, Claude or a voice provider unless you add a key **and** confirm the spend or set the live switch. Mock data is labelled MOCK everywhere.

## One-time setup

```sh
pnpm install
copy .env.example .env.local                 # (cp on macOS/Linux) then fill in the blanks below
pnpm --filter @life/studio hash-passphrase   # paste the output into STUDIO_PASSPHRASE_HASH
pnpm --filter @life/studio approval-key      # writes secrets/approval-ed25519.pem (studio only)
                                             # and secrets/approval-public-keys.json (worker)
```

In `.env.local` set `STUDIO_SESSION_SECRET` (any 40+ random characters) and `LIFE_OWNER_ID=owner`. Generate `INSTAGRAM_TOKEN_KEY` when you connect Instagram:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

`secrets/`, `.env.local`, `.data/`, `storage/`, `auditions/` and `backups/` are git-ignored. Only the studio reads the private approval key; the worker refuses a keys file that contains one.

## Daily use

```sh
pnpm db:start        # window 1: local Postgres on :54329 (no Docker); leave it running
pnpm db:migrate      # after every pull
pnpm studio          # window 2: http://localhost:3100
pnpm worker          # window 3: schedules approved packages, publishes (MOCK by default), collects insights
```

| Task | Command / place |
|---|---|
| Sample episode end to end | `pnpm slice` (stops for your approval), approve in the studio, `pnpm worker --once` |
| Draft + check a script with Claude | `pnpm draft --topic <id> --code LU-TECH-002` (dry run) → add `--confirm-spend` |
| Voice auditions | `pnpm audition` (dry run) → `pnpm audition --confirm-spend` → studio **Voice** page |
| Render a template | `pnpm --filter @life/render render:fixture` (needs ffmpeg) |
| Review evidence, approve / reject / revoke | studio → episode page |
| Something published is wrong | studio → **Corrections** → Flag a problem |
| Jobs, retries, reconciliation | studio → **Jobs** |
| Metrics | studio → **Insights** (live only by default; mock behind a toggle) |
| Experiments | studio → **Experiments** |

## Controls

- **Pause publishing:** Settings → Pause (reason required). Anyone, including the system, can pause; only you can resume. A correction that touches high-risk claims or a public post pauses automatically.
- **Spending:** Settings → Spending. Monthly cap (owner decision: $100, warning at $50). No cap = every paid call refused. Anyone can press the stop; only you can lift it.
- **Revoke:** episode page → Revoke (reason required). Jobs not yet sent to Instagram are cancelled.
- **Material edit:** any new script version revokes approvals for older packages automatically.
- **Sign out:** clears the session cookie in this browser. It does not invalidate a session cookie copied elsewhere; sessions expire after 12 hours. To end every session at once, change `STUDIO_SESSION_SECRET` and restart the studio.

## Going live on Instagram (when you are ready)

1. Follow `docs/research/instagram-capability-record.md` §11 to create the Meta app and generate a long-lived token.
2. Re-verify the capability record's `unverified` items against Meta's pages (a session that can reach developers.facebook.com).
3. Studio → Settings → Instagram → paste the token (stored encrypted).
4. In `.env.local`: `INSTAGRAM_MODE=live`, `INSTAGRAM_CAPABILITIES_VERIFIED=yes`, `LIVE_PUBLISHING_AUTHORIZED=yes`, and set `INSTAGRAM_ACCOUNT_ID` to a new value (e.g. `instagram-main`), different from the one used for mock runs. The worker refuses to start in live mode if any of these, the key or the connection is missing.
   - Each publish job remembers the mode it was created for. A job created in mock mode never runs on the live publisher (and the reverse); the gate rejects it with `adapter_mode_mismatch`. Approvals made for the mock account do not carry over: approve again for the live account.
5. **Cover:** the cover is the video's first frame (owner decision). The render extracts it from the delivery file, and Instagram is told to use frame 0, so the cover on the episode page is the one that appears. A package with a separately designed cover would be refused in live mode (`cover_unsupported`), because localhost cannot host it publicly.
6. Approve one package with a narrow window and watch **Jobs**. The token refreshes weekly; alerts at 14 and 7 days.

### What the worker does when a publish is unclear

- A timeout during publish is never retried blind. The worker first looks for a post on the account carrying the episode code (every package caption must contain it). It retries only after two "not found" reads at least 3 minutes apart, and never if the container reports `PUBLISHED`.
- Once Instagram has returned a media ID, the job is never retried. If that post cannot be confirmed, the job fails with a reason and the episode waits for you to check the account.
- The worker uploads a private copy of the delivery file whose hash matches your approval. If the stored file changed after approval, nothing is uploaded.

### Instagram account changes

- Reconnecting the same Instagram user just refreshes the token. Connecting a different Instagram user to the same studio account is refused; disconnect first.
- Disconnecting revokes every approval for that account.

## Backup and restore

```sh
pnpm db:backup                     # backups/life-<time>.json: every table + per-table sha256 + media index
pnpm db:restore backups/<file>     # into an EMPTY, migrated DATABASE_URL; verifies hashes first
```
Copy the `storage/` folder alongside the backup; the restore reports any media file that is missing or changed. Backups contain your data and the encrypted Instagram token (useless without `INSTAGRAM_TOKEN_KEY`). Keep them private.

A restore revokes every approval it brings back (a backup may predate a revocation) and sends any job that was mid-publish to reconciliation. Approve again after restoring.

## Tests

`pnpm test` (PGlite, no network) · `pnpm typecheck`. CI on GitHub runs both on Linux and Windows, real-Postgres race tests, and a studio build on every push. Render tests: `RENDER_TESTS=1 pnpm vitest run packages/render`.
