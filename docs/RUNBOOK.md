# Runbook (localhost)

Everything runs on your machine. Nothing reaches Instagram, Claude or a voice provider unless you add a key **and** confirm the spend or set the live switch. Mock data is labelled MOCK everywhere.

## What you need

- **Docker Desktop** (Windows or Mac; on Linux, Docker Engine with the Compose plugin). Start it before running anything below.
- **Git**, to download and update the project.

Everything else (Node, pnpm, ffmpeg, Postgres, the video renderer's browser) runs inside Docker. Run all commands from the project folder.

## One-time setup

```sh
git clone -b main https://github.com/Ali-Zaraket/life-updated-studio.git
cd life-updated-studio
copy .env.example .env.local        # Windows (cp on Mac/Linux)
docker compose build                # first build takes a few minutes
docker compose run --rm tools pnpm --filter @life/studio hash-passphrase
docker compose run --rm tools pnpm --filter @life/studio approval-key
```

- **The first `docker compose build` downloads about 1 GB** (base image, ffmpeg, Node packages, the video renderer's browser). On a slow connection that can take 30–60 minutes. Downloads retry on their own; if the build still stops with a network error, run `docker compose build` again: finished steps are cached, so it resumes where it stopped. Later builds take a minute or two.
- `hash-passphrase` asks for your studio password (12+ characters, hidden as you type) and prints a line starting `STUDIO_PASSPHRASE_HASH='scrypt$`. Replace the empty `STUDIO_PASSPHRASE_HASH=` line in `.env.local` with it, **including the single quotes** (the hash contains `$`, which Docker would otherwise read as a variable).
- `approval-key` writes `secrets/approval-ed25519.pem` (the studio's signing key) and `secrets/public/approval-public-keys.json` (the worker's copy, public key only). It refuses to overwrite existing keys.
- In `.env.local` also set `STUDIO_SESSION_SECRET=` to 32+ random characters. To generate one: `docker compose run --rm tools node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- Leave `DATABASE_URL` as it is: inside Docker the services use the `db` container automatically.

`secrets/`, `.env.local`, `storage/`, `auditions/` and `backups/` are git-ignored and never copied into the image. Only the studio container sees `secrets/`; the worker container gets `secrets/public/` and nothing else.

## Daily use

```sh
docker compose up -d --wait         # database, migrations, studio and worker in the background;
                                    # returns once the studio answers at http://localhost:3100
docker compose logs -f worker       # watch the worker (Ctrl+C stops watching, not the worker)
docker compose stop                 # stop everything; your data stays
```

After pulling new code: `docker compose up -d --build --wait` (migrations run automatically on start).

One-off commands run in the `tools` container: `docker compose run --rm tools pnpm <command>`.

| Task | Command / place |
|---|---|
| Sample episode end to end | `docker compose run --rm tools pnpm slice` (stops for your approval), approve in the studio; the worker publishes it to the MOCK account |
| Recheck a pilot's sources (needed within 24 h of publishing, for claims marked "changing") | `docker compose run --rm tools pnpm pilot:recheck content/pilots/LU-TECH-002` — re-fetches each source and confirms every quoted passage is still there |
| Load the reviewed pilot | `docker compose run --rm tools pnpm pilot:load content/pilots/LU-TECH-002` (run the recheck first; otherwise it reports `blocked: changing_claim_not_rechecked`) |
| Draft + check a script with Claude | `docker compose run --rm tools pnpm draft --topic <id> --code LU-TECH-002` (dry run) → add `--confirm-spend` |
| Voice auditions | `docker compose run --rm tools pnpm audition` (dry run) → add `--confirm-spend` → studio **Voice** page |
| Render a template | `docker compose run --rm tools pnpm --filter @life/render render:fixture` |
| Review evidence, approve / reject / revoke | studio → episode page |
| Something published is wrong | studio → **Corrections** → Flag a problem |
| Jobs, retries, reconciliation | studio → **Jobs** |
| Metrics | studio → **Insights** (live only by default; mock behind a toggle) |
| Experiments | studio → **Experiments** |

Notes:
- If a recheck says a source is `UNAVAILABLE` because your connection dropped, it marks those claims `unresolved` in `packet.json`. Undo that with `git checkout content/pilots/LU-TECH-002/packet.json` and run the recheck again. A passage that is really gone from the page needs a script fix and a fresh review.
- All ports bind to `127.0.0.1` only (studio `3100`, Postgres `54329`); nothing is reachable from other machines.
- Lines saying `.env.local not found` in container logs are expected: Compose passes your settings to the containers directly.
- The database lives in the Docker volume `pgdata`. `docker compose down` keeps it; `docker compose down -v` **deletes it** (take a backup first).
- If port 3100 or 54329 is already in use, stop whatever uses it, or change the left-hand number under `ports:` in `compose.yaml`.

### Running without Docker (developers)

Node 22+, pnpm 10.14 and ffmpeg on your machine; Postgres still from Docker: `pnpm install`, `pnpm db:start` (starts only the `db` container on `127.0.0.1:54329`), `pnpm db:migrate`, `pnpm studio`, `pnpm worker`. `.env.local` is read from the project root, and `DATABASE_URL` from `.env.example` already points at that port.

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
docker compose run --rm tools pnpm db:backup                    # backups/life-<time>.json: every table + per-table sha256 + media index
docker compose run --rm tools pnpm db:restore backups/<file>    # only into an EMPTY database (fresh install); verifies hashes first
```
Copy the `storage/` folder alongside the backup; the restore reports any media file that is missing or changed. Backups contain your data and the encrypted Instagram token (useless without `INSTAGRAM_TOKEN_KEY`). Keep them private.

A restore revokes every approval it brings back (a backup may predate a revocation) and sends any job that was mid-publish to reconciliation. Approve again after restoring.

## Tests

`docker compose run --rm tools pnpm test` (PGlite, no network) · `docker compose run --rm tools pnpm typecheck`. CI on GitHub runs both on Linux and Windows, real-Postgres race tests, a studio build, and a Docker job that builds this image, starts the stack, runs the mock slice and a real render inside it. Render tests: `docker compose run --rm -e RENDER_TESTS=1 tools pnpm vitest run packages/render`.
