# LU-TECH-003 — independent AI verification, round 5 (owner's cut)

Reviewer: `claude-opus-5-5` (independent evidence agent, round 5). This is an AI check. It is **not** a qualified human review.
Reviewed: 2026-10-27, against the `source-text/*.txt` snapshots (no change against HEAD).
Subject hash: `0df66fa484dbcd1dd95a12c012d34b5a01f2d804fd66b59ca6a7dc68f1abaac4`, which I computed myself with `pilot-subject.ts`.
`createdAt` on the records is 09:15:45Z. That is the last clock reading I had observed when I wrote them, because shell access was briefly unavailable. The files were written between 09:15:45Z and 09:18:56Z.

## Bottom line

**Not publishable as cut.** Verdicts: 8 `pass`, 2 `pass_with_changes`, 2 `fail`.

- **The wording holds.** Every sentence that lost its "Apple says" / "Google says" is still within its evidence, because each is the platform owner's own description of its own feature. Attribution is kept where it matters, on Apple's encryption claim.
- **Structure fails.** The "how do I check" half of the promise is no longer in the video before the twist. Deterministically, the script has no `takeaway` beat, so `evaluateCreativeRules` raises **`missing_takeaway`** and **`twist_before_takeaway`**. Both are blockers. I confirmed this with an in-memory gate run (see "Gate run" below).
- **Unreported provenance change.** The regeneration stamped a fresh check time with no recheck behind it (see "Packet provenance").

## Diff against HEAD

`script.json` changes:
- Beats 2 and 4 have new narration.
- The takeaway beat is deleted.
- The twist narration, claimIds and on-screen text changed.
- Two visual directions changed.
- The caption's first line changed.
- Timings changed.

The changes match the coordinator's list.

`packet.json` changes (field by field, against HEAD). Claim text, status, limitations, evidence passages and links are unchanged; all 17 passages are still verbatim. The other changes are **not** just "refreshed timestamps":

| Field | HEAD | Now |
|---|---|---|
| `sources[].contentSha256` (all 4) | hashes (Apple ones matched the snapshots) | `null` |
| `provenance.pageSha256` (all 4) | hashes | `null` |
| `provenance.lastRecheckAt` | 2026-10-27T08:30:53.202Z | removed |
| `provenance.pageSha256Note` | "…stable across requests…" | "Set by pilot:recheck." |
| `claims[].lastCheckedAt` (all 12) | 08:30:53.202Z | **09:10:28.669Z** |
| `sources[].retrievedAt` / `retractionCheckedAt` | 08:30:53Z / 08:30:51Z | **09:10:28.669Z** |
| `evidence[].createdAt`, `topic.createdAt`, `provenance.retrievedAt` | 08:30Z | 09:10:28.669Z |

## Packet provenance (required, lead)

The coordinator says the live recheck **could not be run**. Yet every claim's `lastCheckedAt`, and every source's `retrievedAt` and `retractionCheckedAt`, now say 09:10:28Z. That records a check that did not happen.

This matters for two reasons:
- The 24-hour freshness gate (`CHANGING_CLAIM_MAX_AGE_MS`, `gate.ts`) reads `lastCheckedAt`, so the false time would extend freshness by about 40 minutes.
- `claimLedgerSha256` deliberately excludes `lastCheckedAt`, so a change to it would never trigger a re-review on its own.

Required:
- Restore those fields to the last real check (HEAD: claims and `retrievedAt` 2026-10-27T08:30:53.202Z, `retractionCheckedAt` 08:30:51.898Z), or run `pilot:recheck` once tooling is back.
- Have the regeneration tool stop stamping "now" into check fields.

The nulled hashes were a provenance downgrade:
- The Apple hashes were valid (they matched the snapshots) and should be restored: `7f2e0ff3…dcee` and `2945689c…abf`.
- Nulling the Google hashes is defensible given their per-request change, but say so in `pageSha256Note` rather than dropping the note.

## Per-claim verdicts

| Claim | Verdict | Reason |
|---|---|---|
| c-iphone-keeps-places | pass | Beat 2 without "Apple says" is within e1 and keeps both qualifiers. |
| c-iphone-encrypted | pass | Still attributed. Recommended: "On iPhone, Apple says it can't read it." |
| c-iphone-setting-path | **fail** | The promise is not resolved in the video before the twist; gate blockers. |
| c-android-timeline-saves | pass | "Google keeps it on your phone, unless you back it up" is within e5/e11/e16. |
| c-android-timeline-path | **fail** | Same as c-iphone-setting-path. |
| c-timeline-off-by-default | pass | Unchanged. |
| c-timeline-backup | pass | "unless you back it up" matches the per-device opt-in. |
| c-timeline-kept-until-deleted | pass | "Or never: then it's kept until you delete it" is within e12 + e17. |
| c-timeline-off-vs-delete | pass_with_changes | Caption-only now, which is fine. Set `locations` to `["caption"]`. |
| c-timeline-view | pass_with_changes | Backs nothing now. Drop it from `script.claimIds` and clear `locations`, or attach it to the restored takeaway beat. |
| c-other-google-location | pass | Caption only. More important now that beat 4 is unattributed; keep it. |
| c-autodelete-options | pass | Unchanged. |

## Answers to the coordinator's questions

1. **Beat 2 without "Apple says":** within e1. OK.
2. **Beat 4:** "Apple says it can't read it" is supported. The bare "it … it" now follows the Android beat, so prefer "On iPhone, Apple says it can't read it." "Google keeps it on your phone, unless you back it up" matches e5 (saved "to that device") and e11/e16 (opt-in encrypted copy on Google's servers). OK. Optionally widen the caption limit to "Apple and Google describe their own storage and encryption; this video does not test it."
3. **Removing the takeaway:**
   - **No withheld caveat.** The video no longer gives turn-off or delete steps, so no viewer is misled into thinking that turning it off erases the data. The off-vs-delete distinction stays in the caption.
   - **Promise not resolved before the twist.** The episode's resolved question is "…and how do I check?". The only in-video answer is "Where to find it: see the caption", shown *inside* the twist. Reels captions are truncated, and the twist ends on "Go check." This fails the CLAUDE.md rule and both structural gate rules.
   - **Fix that respects the owner's note:** the owner's note was "remove the part of how to remove it or delete it", not the locations. Insert a short takeaway beat between beat 4 and the twist:
     - role: `takeaway`
     - narration: **"Here's where each one lives."**
     - onScreenText:
       - `iPhone: Settings > Privacy & Security > Location Services`
       - `> System Services > Significant Locations & Routes`
       - `Android: Google Maps > profile picture or initial > Your Timeline`
     - claimIds: `c-iphone-setting-path`, `c-android-timeline-path` (and `c-timeline-view` if you keep it)

     That is about 3–4 s. Do not use "look" for iPhone: viewing on iPhone is not documented in these sources. The twist's "Where to find it: see the caption" card can then go. The caption may keep "Where to find it:".
4. **Twist without "Google says":** "then it's kept until you delete it" is within e12 + e17. It is scoped to Google Maps by the preceding clause. OK.
5. **New visuals:** both keep the "Illustration" label, generic data and no branding. OK.
6. **c-timeline-view / c-timeline-off-vs-delete unused in the video:** no rule broken. Fix the ledger `locations` (and `script.claimIds` for c-timeline-view) so the ledger describes the script.

Other rules: no engagement bait ("Go check" checks a setting). The ending does not reference another Reel. 3/18/36 match the sources.

## Gate run (observed after writing, 2026-10-27T09:18:56Z)

Shell access came back. `round-5.json` passes the ReviewRecord schema (12 records). `env -u DATABASE_URL pnpm -s exec tsx apps/worker/src/pilot-cli.ts content/pilots/LU-TECH-003` printed `blocked (in-memory check only)` with these blockers:
- `missing_ai_verification` × 4 (the two fails and two pass_with_changes above)
- `missing_takeaway`
- `twist_before_takeaway`

This confirms the structural finding.

## Could not check

- **Live pages.** No network, and the lead's live recheck did not run either. The passages are verified only against the stored snapshots.
