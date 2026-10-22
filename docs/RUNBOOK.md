# Runbook (local, day 1)

Everything here is local and MOCK. Nothing reaches Instagram or any paid provider.

## One-time setup

```sh
pnpm install
cp .env.example .env.local          # then fill in the blanks below
pnpm --filter @life/studio hash-passphrase   # paste output into STUDIO_PASSPHRASE_HASH
pnpm --filter @life/studio approval-key      # writes secrets/approval-ed25519.pem (studio only)
                                             # and secrets/approval-public-keys.json (worker)
# STUDIO_SESSION_SECRET: any 32+ random characters
```

`secrets/`, `.env.local`, `.data/` and `storage/` are git-ignored. Only the studio reads the private approval key; the worker refuses a keys file that contains a private key.

## Run

```sh
pnpm db:start                 # terminal 1: embedded Postgres on :54329 (no Docker)
pnpm db:migrate               # once, and after pulling new migrations
pnpm slice                    # with DATABASE_URL set: prepares the fixture episode, stops for your approval
pnpm studio                   # terminal 2: http://localhost:3100 — review, approve or reject
pnpm worker --once            # publishes approved packages through the MOCK adapter
```

`pnpm slice` without `DATABASE_URL` runs the whole pipeline in memory, with a clearly labelled SIMULATED approval — useful as a smoke test, never as a real approval.

## Controls

- **Pause publishing:** Settings → Pause (reason required). Anyone, including the system, can pause; only you can resume.
- **Spending stop:** Settings. Anyone can stop; only you can lift it or set a cap. No cap = paid generation disabled.
- **Revoke:** episode page → Revoke (reason required). Jobs not yet sent to Instagram are cancelled.
- **Material edit:** any new script version revokes approvals for older packages automatically.

## Tests

`pnpm test` (PGlite, no network, ~2 min) · `pnpm typecheck`. Live smoke tests (none yet) will live in `tests/live/` and only run with `LIVE_SMOKE=1`.
