# LU-TECH-003 — independent AI verification, round 3

Reviewer: `claude-opus-5-5` (independent evidence agent, round 3). This is an AI check. It is **not** a qualified human review.
Reviewed: 2026-10-26T11:41Z, against the `source-text/*.txt` snapshots (unchanged since round 1).
Subject hash: `58a831d39615480aba264d11f1e1828e00c90707302be4ad81c7fa20606e5b14` (recomputed with `pilot-subject.ts`; matches).

## Bottom line

**All 12 claims: pass.** The five required round-2 changes and the three optional ones are in place. I re-read every beat, the on-screen text and the caption against the ledger, and nothing in the final wording goes beyond its evidence. From the AI-verification side this script is ready for owner review. It still needs the owner's approval; nothing here substitutes for it.

## Evidence (verbatim, normalised as in `source-check.ts`)

All 17 passages (e1–e17, no e7 duplicate) are found verbatim in their snapshots, and each fully supports the claim text it is attached to:
- e15 (Turn off Timeline steps) now backs "it can be turned off" in c-android-timeline-path.
- e16 (separate opt-in for backups) backs "backup is optional" in c-timeline-backup.
- e17 ("Don't auto-delete activity") backs "auto-delete can be switched off" in c-timeline-kept-until-deleted.

## Round-2 changes confirmed

| # | Change | Status |
|---|---|---|
| 1 | Beat 5: "Here's where it lives. On iPhone, you can turn it off. In Google Maps, look through it, then keep it, turn it off, or delete it." | Done. iPhone gets only the documented action; look/keep/delete are scoped to Google Maps. |
| 2 | Beat 6 claimIds include c-android-timeline-saves and c-iphone-keeps-places | Done |
| 3 | e15 on c-android-timeline-path | Done, verbatim |
| 4 | e16 on c-timeline-backup | Done, verbatim |
| 5 | e17 on c-timeline-kept-until-deleted | Done, verbatim |
| opt | Beat 4 "On iPhone, Apple says it can't read yours." | Done |
| opt | Beat 6 "You can set Google Maps to auto-delete it…" | Done |
| opt | c-autodelete-options text no longer includes "36 months is three years" | Done |

The re-timed beats (0–62.9 s, ~146 wpm) leave every beat's role and order unchanged. The takeaway still resolves the promise before the single final twist.

## Rules check

- No engagement bait. "Go check" is an instruction to check a setting.
- The ending does not point to another Reel (`endingReferencesRelated: false`).
- No caveat is withheld:
  - Off by default
  - Backup to Google's servers
  - Turn off vs delete
  - Unknown iPhone default and viewing
  - Other Google location settings
  - Unverified encryption
- Every map visual is labelled "Illustration".
- Single-origin justifications are acceptable for platform-owner documentation.
- 3/18/36 months match the sources exactly.

## Carried-over notes (not blocking)

- The two Google snapshot hashes still don't match `contentSha256`. The Google Help page text changes between requests, so the "stable across requests" provenance note is wrong for those pages. This is a fetcher issue for the lead.
- Not checked: live pages (no network; relied on the lead's live recheck), and whether menu names match current iOS and Google Maps builds.
- Timestamp correction: round-2 records originally carried `createdAt` 12:10Z, a time I estimated rather than read. I corrected them to the actual file write time, 11:39:47Z. Round 2 binds to a superseded subject hash, so this has no effect on the gate.
