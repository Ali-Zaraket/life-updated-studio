# LU-TECH-003 — independent AI verification, round 6

Reviewer: `claude-opus-5-5` (independent evidence agent, round 6). This is an AI check. It is **not** a qualified human review, and it is not the owner's approval.
Reviewed: 2026-10-27T09:21Z, against the `source-text/*.txt` snapshots (unchanged against HEAD).
Subject hash: `0b8ea10a2ec5d0192041666c24f44f58577d59595ba23ab8fa98b90eb4069c76`. I computed it myself, and it matches the coordinator's.

## Bottom line

**All 12 claims: pass.** Every round-5 requirement is met:
- the takeaway is restored before the twist;
- the twist's pointer card is gone;
- the iPhone line is scoped;
- the ledger `locations` are accurate;
- the provenance is honest.

After writing `round-6.json`, I ran the in-memory gate (`env -u DATABASE_URL … pilot-cli.ts content/pilots/LU-TECH-003`). It printed `verified (in-memory check only)`.

## Diff against HEAD

**`script.json`.** All changes match the coordinator's list:
- Beat 2 (unattributed) and beat 4 ("On iPhone, Apple says it can't read it. Google keeps it on your phone, unless you back it up.") were assessed in round 5 and are fine.
- The takeaway is now "Here's where each one lives." with four path lines. Each line is at most 57 characters and matches e3/e6 and the caption exactly. It has no "look" and no removal steps.
- The twist uses "then it's kept until you delete it", has no caption pointer, and its claimIds are back to the four it uses.
- The caption opens "Here is where each setting lives."

**`packet.json`.** Field-by-field diff:

| Field | Change | Assessment |
|---|---|---|
| `claims[].lastCheckedAt`, `sources[].retrievedAt`, `provenance.lastRecheckAt` | 08:30:53Z → 09:20:12.064Z | Driven by the live `pilot:recheck` the coordinator reports. The generator no longer stamps check times on its own. |
| `sources[].retractionCheckedAt` | unchanged (08:30:51Z) | Correct, because the recheck does not check retractions. |
| Google `contentSha256` / `pageSha256` | new values | Expected from a recheck (per-request page variance). The Apple hashes are back to the valid `7f2e0ff3…` / `2945689c…`, and both match the snapshots. |
| `evidence[]` | unchanged | All 17 passages are verbatim in the snapshots. |
| `locations` | path claims → `["visual","caption"]`; c-timeline-off-vs-delete and c-timeline-view → `["caption"]` | Accurate. |
| c-timeline-view `limitations` | notes it is not used in the video | See below. |

## Per-claim verdicts

All `pass`:

- c-iphone-keeps-places
- c-iphone-encrypted
- c-iphone-setting-path
- c-android-timeline-saves
- c-android-timeline-path
- c-timeline-off-by-default
- c-timeline-backup
- c-timeline-kept-until-deleted
- c-timeline-off-vs-delete
- c-timeline-view
- c-other-google-location
- c-autodelete-options

## Recommendations (not blocking)

1. **Readability of the takeaway.** The beat lasts 3.6 s, and its four path lines (about 170 characters) appear one at a time. Few viewers can read that in 3.6 s. Holding the path card over the first ~3 s of the twist, or adding a short silent hold, would make the answer usable on screen. The caption repeats the paths, so nothing is withheld, and the rules are met as written.
2. **c-timeline-view.** You asked whether I'd rather remove it. Either is acceptable. No sentence asserts it directly. Its real job is to back "Go check" at Google Maps > Your Timeline (e13: Timeline "shows where and how you traveled"). The most accurate ledger would add it to the twist's claimIds and say so in the limitation. Removing it from `script.claimIds` is also fine.

## Rules check

- The promise is resolved in the takeaway before the single, final twist.
- No engagement bait.
- No caveat is withheld; the caption Limits are unchanged.
- The ending does not point to another Reel.
- Every map visual is labelled "Illustration".
- 3/18/36 months are exact.

## Could not check

- **Live pages:** no network. I relied on the coordinator's 09:20:12Z live recheck. The stored snapshots are not the text the new Google hashes were computed from (known per-request variance), so the Google passages are verified against the snapshots on disk.
