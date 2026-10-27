# LU-TECH-003 — independent AI verification, round 4 (re-sign after evidence-id rename)

Reviewer: `claude-opus-5-5` (independent evidence agent, round 4). This is an AI check. It is **not** a qualified human review.
Reviewed: 2026-10-27T08:32Z.
Subject hash: `78ec24fabea153f608ed31dc735189813450f76098bfd84bb068f74d948be1ae` (recomputed with `pilot-subject.ts`; matches).

## Bottom line

**All 12 claims: pass.** The only changes since round 3 are evidence ids, timestamps and the hashes stored for the two Google pages. No wording, claim, passage, link, script or caption changed. The round-3 assessment stands.

## How I confirmed it

1. **Baseline.** I rebuilt the HEAD versions of `packet.json` and `script.json` in a scratch directory and ran `pilot-subject.ts` on them. They reproduce the round-3 subject hash `58a831d3…5b14`, so HEAD is exactly what round 3 signed.
2. **Script and snapshots.** `git diff HEAD` shows no change to `script.json` or to `source-text/`.
3. **Packet.** A field-by-field comparison of the current `packet.json` against HEAD shows only these changes:

| Kind | Count | Notes |
|---|---|---|
| `evidence[].id` | 17 | `eN` → `lt3-eN`. Still unique. `claimId`, `sourceId`, passage and locator are unchanged on every row. |
| Timestamps | 40 | `topic.createdAt`, `sources[].retrievedAt` / `retractionCheckedAt`, `claims[].lastCheckedAt`, `evidence[].createdAt`, `provenance.retrievedAt` / `lastRecheckAt` |
| Google page hashes | 2 + 2 | `contentSha256` and `provenance.pageSha256` for `src-google-timeline-android` / `-ios` |

The last row is the per-request instability of Google Help page text already noted in rounds 1–3. It is not an evidence change: the passages are unchanged and still verbatim.

4. **Passages.** All 17 passages are still verbatim (normalised as in `source-check.ts`) in the unchanged snapshots.

## Per-claim verdicts

All `pass`, carried forward from round 3 with no change in substance:

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

## Notes for the lead (not blocking)

- Loader collision: LU-TECH-002 still uses bare `e1`… ids. Any future pilot with bare ids will collide again. A per-episode prefix convention, or a loader check that fails on a duplicate global id instead of silently dropping rows, would prevent this. That is outside this review's scope.
- Google page-hash instability is still open (fetcher issue).
- Not checked: the live pages (no network; relied on the lead's live recheck).
