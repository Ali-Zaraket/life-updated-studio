# LU-TECH-002: independent AI verification, round 8

Reviewer: `claude-opus-5-5` (independent evidence agent, round 8). This is an AI check. It is **not** a qualified human expert review.
Reviewed: 2026-10-22T11:28:13Z, against `source-text/*.txt` snapshots only. I did no live fetch this round; the packet's last recheck is 2026-10-22T11:13:04.482Z.
Subject hash (`pnpm -s pilot:subject`): `990cf7d3e07977b59d09f4695e5fc42c21e0b273ac9e14daff607f5ba72c9a5e`

## What changed since round 7 (checked, not assumed)

`git log -2 -p -- script.json` shows one commit after round 7 (a0eace9). It adds `onScreenText` to two beats and changes nothing else:

- **Mechanism beat:** 5 lines.
- **Takeaway beat:** 2 lines.
- **Unchanged:** narration, visual notes, caption, source list and link fields.

I still judged the whole current script, not just the diff.

All 11 evidence passages appear word for word, exactly once, in the normalised snapshot text. Neither snapshot contains instructions aimed at reviewers.

## Bottom line

No required changes. All six claims `pass`.

| Claim | Verdict | On-screen lines checked | Evidence |
|---|---|---|---|
| c-two-characteristics | pass | "When: foreground or background", "How exact: precise or approximate" | e1 |
| c-foreground-definition | pass | "Foreground: on screen, or running with ongoing notification" | e6, e7 |
| c-android11-settings | pass | "Android 11+: background is a separate settings option", "Check each app: allowed all the time?" | e2, e8, e10 (+ e11) |
| c-approximate-applies | pass | "Approximate stays approximate, even in background", "Pick approximate where offered and enough" | e3, e4 |
| c-background-reminder | pass | none (twist has no onScreenText) | e5 |
| c-pre10-background | pass | none (caption only) | e9 |

## On-screen lines read without the narration

Line lengths: 30, 59, 53, 33, 49, 37 and 41 characters. All are within the 60-character limit, and each beat has no more than 5 lines.

1. **"When: foreground or background"** is e1.
2. **"Foreground: on screen, or running with ongoing notification"** is e6: a visible activity, or a foreground service, which shows a persistent notification.
   - It does not claim that any notification makes an app foreground.
   - The screen omits the background definition (e7). The narration has it, and leaving it out misstates nothing.
3. **"Android 11+: background is a separate settings option"** is e2 and e8.
   - It sits right below line 1, so "background" reads as background location access.
   - "Separate" (from the pop-up) matches e2.
   - It also holds when an app targets Android 10 or lower on an 11+ phone: e10 says that dialog sends the user to the settings page.
4. **"How exact: precise or approximate"** is e1.
5. **"Approximate stays approximate, even in background"** is e3 and e4. The subject (an approximate grant) is clear from line 4.
6. **"Check each app: allowed all the time?"** is e8 (the option label) and e10 (the per-app settings page).
   - Pre-Android-10 phones have no such option.
   - The caption limit (e9) covers this, and the line is a question, not an assertion.
7. **"Pick approximate where offered and enough"** is advice that follows from e3/e4.
   - "Where offered" keeps the hedge that versions are not sourced.
   - "Enough" is terse but accurate.

## Optional (none affects a verdict)

1. **Takeaway line 2, stylistic only.** "Pick approximate where offered and exact isn't needed" (54 chars) would echo the narration more closely.
2. **`locations` has no on-screen value.** `ClaimLocation` (contracts) has no `on_screen_text` value, and the claims shown on screen list only `hook`/`narration`/`caption`.
   - Either add `visual` to those claims' `locations`, or the lead could add an `on_screen_text` location to the contract.
   - I made neither edit.
3. **Carried from round 7:**
   - The e9 locator wording.
   - An unversioned caption limit that the precise/approximate choice isn't offered everywhere.
   - A `round8Changes` provenance note for the on-screen text.

## Findings outside claim verdicts (lead to decide)

- **Freshness.** All claims are `changing`. They need a recheck by 2026-10-23T11:13:04Z if publication is later.
- **Licence.** The Content Licence is still not fetched. The on-screen lines paraphrase and do not quote, so this does not block them.
- **`retractionCheckedAt`** is still 10:36:27Z.

## Gate output

See the hand-off report. A gate result is an in-memory evidence/review check only. It is not owner approval and does not authorise publication; the owner is the sole release approver.
