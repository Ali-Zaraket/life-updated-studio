# LU-TECH-002: independent AI verification, round 6

Reviewer: `claude-opus-5-5` (independent evidence agent, round 6). This is an AI check. It is **not** a qualified human expert review.
Reviewed: 2026-10-22T11:11:04Z. I checked against `source-text/*.txt` (retrieved 2026-10-22T10:36:27Z) and against my own live English fetch of both pages at about 11:10Z.
Subject hash (script + claim ledger, `pnpm -s pilot:subject`): `8708014f4b1d9bea9ea14f558d8eb6ad3eeeebc09631fe30ebb9f63f5822d472`

## What changed since round 5 (checked, not assumed)

- `git log -3 -p` on packet.json and script.json shows:
  - script.json last changed in e0da560 (round 4, before round 5).
  - 72a9f92 added the ledger binding.
  - 9595372 changed only six claim `lastCheckedAt` values plus both sources' `retrievedAt` and `contentSha256`. Nothing else changed: no claim text, status, evidence, beat or caption.
- Live recheck, done independently:
  - All 11 passages appear word for word, exactly once each, in both the snapshots and the live pages (whitespace-normalised).
  - The live extracted text of each page is **identical** to its snapshot after normalisation (8485 and 4438 chars). Both pages still say "Last updated 2026-10-16 UTC".
- The live pages contained no instructions aimed at reviewers.

## Bottom line

One required change (the hook). Five claims `pass`; `c-two-characteristics` is `pass_with_changes`.

| Claim | Verdict | Evidence |
|---|---|---|
| c-two-characteristics | **pass_with_changes** | e1 |
| c-foreground-definition | pass | e6, e7 |
| c-android11-settings | pass | e2, e8, e10 (+ e11 context) |
| c-approximate-applies | pass | e3, e4 |
| c-background-reminder | pass | e5 |
| c-pre10-background | pass | e9 |

## Required change

**Hook narration (c-two-characteristics).** The hook currently says "An Android app asks for your location. You're making two choices."

e1 says each *permission* has two characteristics (category and accuracy). It does not say the *user* makes two choices, and this packet shows the user does not make both everywhere:

- **Android 9 and earlier:** e9 says foreground access automatically includes background access. There is no separate "when" choice.
- **Accuracy:** no source in the packet says which Android versions let the user pick approximate or precise. The script admits this in the takeaway ("pick approximate where it's offered"). An unconditional hook contradicts the script's own hedge.

Rounds 1 to 5 accepted the hook because beat 2 qualifies it. Beat 2 only covers the Android 11+ pop-up. It covers neither the accuracy choice nor Android 9 and earlier. I am not downgrading on style: this is a factual statement to every Android viewer that the packet does not support for every Android viewer.

Exact replacement (11 words, same count as now, fits the 4.5 s slot, matches e1 and the caption's first line):

> "An Android app wants your location. That access has two parts."

Alternative: keep the current hook only after adding an official source and a version-qualified claim (with a caption limit) for when the user-facing accuracy choice exists. My background understanding is Android 12. That is **not evidenced in this packet** and must not be added without a source.

The rest of the script ("First: when ... Second: how exact ...") reads correctly after either fix. Optional: the hook visual's "dials" suggest the viewer controls both. "Two labelled panels" would match "parts", but this does not affect any verdict.

## Beat by beat (other lines)

- **Mechanism.**
  - "Foreground: the app is on screen, or running with an ongoing notification." Within e6.
  - "Background: any other time." Within e7.
  - "On Android 11 and newer, background access isn't in the pop-up; it's a separate option in settings." Within e2 and e8.
  - "Second: how exact ..." Within e1.
  - "Grant approximate, and the app only gets approximate location, even in the background." Within e3 and e4.
- **Takeaway.** Within e10 (per-app settings page), e8 ("Allow all the time") and e3/e4. "Where it's offered" hedges availability.
- **Twist.** Within e5. It says nothing about timing or repeats. The promise is answered before the twist, no caveat is withheld, there is no engagement appeal, and the ending does not point to another Reel (`endingReferencesRelated: false`).
- **Caption.** Every line stays within e1, e2, e9 and the limitations. The sources list (titles, URLs, page updated 16 Oct 2026, retrieved 22 Oct 2026) matches the packet.

## Locators

All locators name the correct heading or the Figure 7 caption. Optional: change e9's parenthetical to "(paragraph with the Android 10 manifest requirement)", because the passage now includes that sentence.

## Findings outside claim verdicts (lead to decide; none affects a verdict)

1. **`contentSha256` cannot be reproduced.**
   - Two back-to-back fetches of the same page gave different raw-HTML sha256 values with identical extracted text. My fetch also differed from the 11:08:28Z values in the packet.
   - The field cannot detect content changes, and `pilot:recheck` will report "page bytes changed" on every run.
   - Suggest hashing the normalised extracted text instead, and saving that text as the snapshot.
2. **Provenance is now out of step with the source records.** `provenance.retrievedAt` and `provenance.pageSha256` still hold the 10:36:27Z values, while `sources[].retrievedAt` and `contentSha256` hold the 11:08:28Z ones. The `source-text/` snapshots belong to the 10:36 fetch. Their content matches live, as verified above.
3. **`retractionCheckedAt` is still 10:36:27Z.** The recheck does not refresh it, which is honest if no new correction check was done.
4. **Freshness.** All claims are `changing`; lastCheckedAt is 2026-10-22T11:08:28.019Z. They need another recheck by 2026-10-23T11:08:28Z if publication is later.
5. Round 5's optional point on `locations` omitting `visual` still stands.

## Gate output

See the hand-off report for the runs before and after this file was written. A gate result is an in-memory evidence/review check only. It is not owner approval and does not authorise publication; the owner remains the sole release approver.
