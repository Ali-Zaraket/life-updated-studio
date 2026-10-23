# LU-TECH-002: independent AI verification, round 7

Reviewer: `claude-opus-5-5` (independent evidence agent, round 7). This is an AI check. It is **not** a qualified human expert review.
Reviewed: 2026-10-22T11:14:29Z. I checked against `source-text/*.txt` (retrieved 2026-10-22T10:36:27Z) and against my own live English fetch of both pages at about 11:14Z.
Subject hash (script + claim ledger, `pnpm -s pilot:subject`): `7717f0245fc4bb94dbe669a0b409a8bc524145c5570ca704491d3ab0a2785444`

## What changed since round 6 (checked, not assumed)

`git log -4 -p` shows one commit after round 6 (380177f):

- **script.json:** only the hook beat changed.
  - Narration: "An Android app asks for your location. You're making two choices." became "An Android app wants your location. That access has two parts." This is the round-6 replacement, word for word.
  - Visual: "two labelled dials" became "two labelled panels".
  - No other beat, caption, source list or link field changed.
- **packet.json:**
  - All six claims' `lastCheckedAt` and both sources' `retrievedAt` moved to 2026-10-22T11:13:04.482Z.
  - `contentSha256` and `provenance.pageSha256` are now sha256 of the normalised extracted text, with a matching `pageSha256Note`.
  - `provenance.lastRecheckAt` was added.
  - No claim text, status, limitation, evidence passage or locator changed.

## Live recheck (done independently)

- Each of the 11 passages appears word for word, exactly once, in both the snapshots and the live pages (normalised with `source-check.ts` `normalize`).
- The live normalised text of each page is identical to its snapshot: 8485 and 4438 chars.
- The sha256 of that text is identical for live and snapshot, and matches the packet:
  - `98119e24…c8a` (location permissions)
  - `ffca45b2…c3c` (background location)
- This resolves round-6 findings 1 and 2. The hash is now reproducible, and `provenance.pageSha256` agrees with `sources[].contentSha256` and with the 10:36 snapshots.
- Both pages still say "Last updated 2026-10-16 UTC".
- Neither page contained instructions aimed at reviewers.

## Bottom line

No required changes. All six claims `pass`.

| Claim | Verdict | Evidence |
|---|---|---|
| c-two-characteristics | pass | e1 |
| c-foreground-definition | pass | e6, e7 |
| c-android11-settings | pass | e2, e8, e10 (+ e11 context) |
| c-approximate-applies | pass | e3, e4 |
| c-background-reminder | pass | e5 |
| c-pre10-background | pass | e9 |

## Beat by beat

- **Hook.** "That access has two parts" matches e1: each permission combines a category and an accuracy.
  - It no longer claims the viewer makes two choices.
  - It still holds on Android 9 and earlier: the permission still has a category, and foreground access simply includes background (e9).
  - "Panels" in the visual no longer implies the viewer controls both.
- **Mechanism.**
  - "On screen / ongoing notification" is within e6.
  - "Any other time" is within e7.
  - The Android 11+ pop-up/settings line is within e2 and e8.
  - "Precise or approximate" is within e1.
  - "Grant approximate ... even in the background" is within e3 and e4.
- **Takeaway.**
  - The per-app settings page is within e10, and "Allow all the time" within e8.
  - "Where it's offered" hedges the approximate choice. The packet has no source saying which Android versions offer it, and the line does not claim any.
- **Twist.**
  - Within e5: it says "schedules", with nothing on timing or repeats.
  - The promise is resolved first, and no caveat is withheld.
  - There is no engagement appeal, and `endingReferencesRelated: false`.
- **Caption.**
  - Every line stays within e1, e2 and e9 and the claim limitations.
  - The sources list (titles, URLs, page updated 16 Oct 2026, retrieved 22 Oct 2026) matches the packet.
  - "Version means your Android version, not your phone maker's software version" is a clarification of the sources' "device that runs Android N" wording, not a new factual claim.

## Optional (none affects a verdict)

1. **e9 locator.** It could read "(paragraph with the Android 10 manifest requirement)", since the passage now includes that sentence. Carried from round 6.
2. **Caption limit on accuracy.** A caption limit such as "The precise/approximate choice isn't offered on every Android version" would make the takeaway's "where it's offered" explicit. It must stay unversioned unless an official source is added.
3. **Provenance.** The packet has no `round6Changes`/`round7Changes` note recording the hook change. Adding one would keep the provenance trail complete.
4. **`locations` omits `visual`** (carried from round 5). The hook and mechanism visuals restate c-two-characteristics and c-foreground-definition.

## Findings outside claim verdicts (lead to decide)

- **`retractionCheckedAt` is still 10:36:27Z.** This is honest if no new correction check was done since.
- **Freshness.** All claims are `changing`, and `lastCheckedAt` is 2026-10-22T11:13:04.482Z. They need another recheck by 2026-10-23T11:13:04Z if publication is later.
- **Licence.** Content Licence (developer.android.com/license) is still not fetched. Confirm it before quoting passages on screen. The current script paraphrases and does not quote on screen.

## Gate output

See the hand-off report for the runs before and after this file was written. A gate result is an in-memory evidence/review check only. It is not owner approval and does not authorise publication; the owner remains the sole release approver.
