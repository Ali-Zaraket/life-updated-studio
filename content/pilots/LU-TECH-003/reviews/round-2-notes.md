# LU-TECH-003 — independent AI verification, round 2

Reviewer: `claude-opus-5-5` (independent evidence agent, round 2). This is an AI check. It is **not** a qualified human review.
Reviewed: 2026-10-26T11:39Z, against the `source-text/*.txt` snapshots. They are unchanged since round 1.
Subject hash: `9879ebf7fdc33529b76bd4a3274a4baa8829b2e1e3c621dc81642c711278b1ed` (recomputed with `pilot-subject.ts`; matches).

## Bottom line

**Close, but not yet publishable.** Every round-1 overclaim is fixed, and the tightening for length did not bring any back. One script edit is still required. In beat 5, iPhone viewers have the iPhone path on screen but get no narrated action of their own, so "look through it … delete it" reads as applying to iPhone, which the sources don't support. Four small ledger fixes are also needed: two claims assert things their evidence rows don't contain, one claim lost its turn-off evidence when e7 moved, and beat 6 does not link the claim behind "it's on your phone right now".

Verdicts: 8 `pass`, 4 `pass_with_changes`, 0 `fail`. Each fix changes the subject hash, so round 3 needs to confirm the fixes and nothing else.

## Evidence passages (verbatim, normalised as in `source-check.ts`)

All 14 rows are found verbatim in their snapshot: e1–e14, with e7 replaced. Support check:

| Evidence | Claim | Supports claim text fully? |
|---|---|---|
| e1 | c-iphone-keeps-places | yes |
| e2 | c-iphone-encrypted | yes |
| e3 | c-iphone-setting-path | yes |
| e4, e5 | c-android-timeline-saves | yes |
| e6 | c-android-timeline-path | **partly**. Supports the path, not "it can be turned off in Location & privacy settings" (e7 moved away). |
| e7 | c-timeline-off-vs-delete | yes |
| e10 | c-timeline-off-by-default | yes |
| e11 | c-timeline-backup | **partly**. Supports the encrypted copy on Google's servers, not "backup is optional". |
| e12 | c-timeline-kept-until-deleted | **partly**. Supports "kept until you delete it", not "auto-delete can be switched off". |
| e13 | c-timeline-view | yes |
| e14 | c-other-google-location | yes |
| e8, e9 | c-autodelete-options | yes |

Verified, ready-to-attach passages (all in `src-google-timeline-android.txt`):
- for c-timeline-backup: `You have to separately opt-in to turn on Timeline backups on each device.`
- for c-timeline-kept-until-deleted: `Under "Location settings," tap Auto-delete Timeline Don't auto-delete activity.`
- for c-android-timeline-path (or trim the claim text instead): the e7 passage.

Hashes: the Apple snapshots match `contentSha256`. The Google ones still do not. The packet now holds `14174de7…` / `446bc081…`, which differs both from round 1 and from the sha256 of the stored snapshots. This confirms that the normalised Google Help text changes between requests (per-request token near the end), so `pageSha256Note` ("stable across requests") is wrong for these two pages. This is not a blocker for the claims: the passages are present in the stored snapshots, and the lead reports they are present live. It is a provenance issue to fix in the fetcher (strip the token, or store the snapshot that was hashed).

## Per-claim verdicts

| Claim | Verdict | Required change |
|---|---|---|
| c-iphone-keeps-places | pass | none |
| c-iphone-encrypted | pass | optional: "On iPhone, Apple says it can't read yours." |
| c-iphone-setting-path | **pass_with_changes** | beat 5 iPhone clause (below) |
| c-android-timeline-saves | **pass_with_changes** | add claim IDs to beat 6 |
| c-android-timeline-path | **pass_with_changes** | trim claim text or attach the e7 passage |
| c-timeline-off-by-default | pass | none |
| c-timeline-backup | **pass_with_changes** | add opt-in evidence row |
| c-timeline-kept-until-deleted | **pass_with_changes** | add "Don't auto-delete activity" evidence row |
| c-timeline-off-vs-delete | pass | none |
| c-timeline-view | pass | none |
| c-other-google-location | pass | none |
| c-autodelete-options | pass | nits only |

## Beat-by-beat (focused on the tightening)

**Beat 1:** unchanged. Acceptable now that beats 2–3 state the conditions.

**Beat 2:** "with Significant Locations and Routes on, Apple says it keeps track of where you've recently been, how often, when, and your routes." **OK.** Both qualifiers are back, and "where you've recently been" is equivalent to e1's "places you have recently been".

**Beat 3:** "Google Maps Timeline is off until you turn it on. Then it saves your visits and routes to your phone, even with Google apps closed." **OK.** It matches e10, e4 and e5. "Closed" is equivalent to "aren't open".

**Beat 4:** "Apple says it can't read yours. Google says Timeline stays on your phone, unless you turn on backup." **OK.** The diary line is gone and the visual is labelled. Optional: add "On iPhone," before "Apple says", since the line now follows the Android beat.

**Beat 5:** "Here's where it lives. Look through it in Google Maps, then keep it, turn it off, or delete it." **Needs one edit.** The iPhone path is on screen, and the narration gives iPhone no action of its own. So iPhone viewers will hear "look through it … delete it" as instructions for their phone, or will go to Google Maps for their Apple data. For iPhone, the Apple sources document only turning the setting off; viewing and Clear History are documented for Mac only.
- Old: "Here's where it lives. Look through it in Google Maps, then keep it, turn it off, or delete it."
- New: **"Here's where it lives. On iPhone, you can turn it off. In Google Maps, look through it, then keep it, turn it off, or delete it."**

This is about 4 words longer and fits the 9.5 s beat. It is backed by e3, e13, e7 and e12. Add c-timeline-kept-until-deleted to beat 5's claimIds if "delete it" is meant to rest on it.

**Beat 6:** "Google Maps can auto-delete it after three, eighteen or thirty-six months. Or never: Google says it's kept until you delete it. If it's on, it's on your phone right now. Go check." **OK on wording.** It no longer presents 36 months as the maximum. Dropping "36 months = 3 years" is fine: nothing on screen or in the narration now implies three years is the default. "Off = kept until you delete it" is exact.
- Required, ledger only: add `c-android-timeline-saves` and `c-iphone-keeps-places` to beat 6 `claimIds`. They support "If it's on, it's on your phone right now."
- Optional: "You can set Google Maps to auto-delete it…".
- Rules: "Go check" is not engagement bait. The promise is resolved in beat 5. The twist is the last beat. The ending doesn't reference another Reel.

**Caption:** The Limits line matches round 1's wording and every statement in it is backed by a claim (or is a true statement about what the Apple sources don't say). The paths are exact. **OK.**

## Could not check

- Live pages: no network here. I relied on the lead's report that the live recheck passed.
- Whether menu names match current iOS and Google Maps builds.
