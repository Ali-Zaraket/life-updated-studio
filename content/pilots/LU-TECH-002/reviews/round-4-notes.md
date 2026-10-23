# LU-TECH-002: independent AI verification, round 4

Reviewer: `claude-opus-5-5` (independent evidence agent, round 4). This is an AI check. It is **not** a qualified human expert review.
Reviewed: 2026-10-22T10:58:25Z, against `source-text/*.txt` (retrieved 2026-10-22T10:36:27Z; both pages say "Last updated 2026-10-16 UTC").
Script subject hash: `08029142f4834cda2f1c088c0a7af698fb7faed43debffd2775fda6959eac4f4`

I judged the current script and packet on their own. Earlier rounds were context only.

## Bottom line

All ten evidence passages (e1 to e10) appear word for word in the snapshots, once each (whitespace-normalised). No claim misstates its source, and the script and caption need **no changes**. Two **ledger locator** fixes are required: e2 and e3 name sections that the source pages do not have. These are accuracy errors in the evidence record, not style preferences, so the two affected claims are `pass_with_changes`. The gate stays **blocked** until the fixes are made and those claims are reviewed again.

| Claim | Verdict | Reason |
|---|---|---|
| c-two-characteristics | pass | Matches e1. The hook is broad, but beat 2 qualifies it |
| c-foreground-definition | pass | Matches e6 and e7. The lay gloss is accurate |
| c-android11-settings | **pass_with_changes** | Substance supported (e2, e8, e10). The e2 locator names the page title, not the section |
| c-approximate-applies | **pass_with_changes** | Substance supported (e3, e4). The e3 locator names a section that does not exist |
| c-background-reminder | pass | Matches e5 |
| c-pre10-background | pass | e9 now includes the Android 10 sentence, so the "earlier than 10" boundary is in the passage |

## Required changes (ledger only, no script or caption change)

1. **e2 (c-android11-settings).** The locator `Section: Request background location` is the page's H1 title. The passage (request-background-location.txt, lines 55 to 57) sits under the heading "Permission dialog contents depend on target SDK version" (line 50). Replace with:
   `Section: Permission dialog contents depend on target SDK version`
2. **e3 (c-approximate-applies).** The locator `Section: Approximate location` matches no heading in request-location-permissions.txt. The passage (lines 144 to 146) is in the "Accuracy" section (line 128). It comes after both the "Approximate" and the "Precise" definitions and is not part of the "Approximate" entry. Replace with:
   `Section: Accuracy (paragraph after the Approximate and Precise definitions)`

The subject hash covers only the beats and the caption, so neither edit changes it. Both claims still need a fresh AI review after the edits.

## Locator check (all passages)

| Evidence | Locator | Correct? |
|---|---|---|
| e1 | Types of location access | yes |
| e2 | Request background location | **no**: that is the page title. The section is "Permission dialog contents depend on target SDK version" |
| e3 | Approximate location | **no**: there is no such section. It belongs under "Accuracy" |
| e4 | User can affect background location accuracy | yes |
| e5 | Reminder of background location grant | yes |
| e6 | Foreground location | yes |
| e7 | Background location | yes |
| e8 | Figure 7 caption | yes (request-background-location.txt, lines 47 to 49) |
| e9 | Background location (after the Android 10 manifest requirement) | yes |
| e10 | App targets Android 10 or lower | yes |

## Beat by beat

**Hook (0 to 4.5 s).** "An Android app asks for your location. You're making two choices." This is supported by e1. The user does grant or refuse background access, and does grant approximate or precise (e3, e4). On Android 11+ the "when" choice for background is not in the pop-up, and beat 2 says so straight away. The visual is a generic prompt with no real UI text, labelled "Illustration".

**Mechanism (4.5 to 25.6 s).**
- "Foreground: the app is on screen, or running with an ongoing notification." This glosses e6 (a visible activity, or a foreground service with a persistent notification). It does not claim that any ongoing notification counts.
- "Background: any other time." Matches e7.
- "On Android 11 and newer, background access isn't in the pop-up; it's a separate option in settings." Matches e2 and e8. It also holds for apps targeting Android 10 or lower, whose dialog only links to the settings page (e10).
- "Second: how exact, precise or approximate." Matches e1.
- "Grant approximate, and the app only gets approximate location, even in the background." Matches e3 and e4.
- The visual matches the narration and is labelled "Illustration".

**Takeaway (25.6 to 35.9 s).** "So in each app's location permission settings, check whether it's allowed all the time, and pick approximate where it's offered and your exact spot isn't needed." This is advice based on e10 (per-app location permission options on a settings page), e8 (the "Allow all the time" option) and e3 and e4. "Where it's offered" correctly hedges a point the sources do not settle. The visual is a checklist text card, not a phone screen, so it needs no illustration label.

**Twist (35.9 to 50.0 s).** "And on Android 10 and newer, after you allow an app all the time, Android schedules a reminder the first time it uses location in the background. A good moment to check it still needs it." Matches e5. It does not say when the reminder is shown or whether it repeats. The visual is labelled "Illustration — not Android's actual notification".

**Twist logic.**
- The promise ("what exactly are you choosing?") is resolved in beats 2 and 3, before the twist.
- The twist is a consequence of the "all the time" grant, so it follows from the evidence.
- Nothing essential is withheld, and there is no engagement appeal.
- The ending does not point to another Reel (`endingReferencesRelated: false`, `relatedEpisodeId: null`). The next question appears only in link metadata, marked as a future episode.

## Caption, line by line

| Line | Status |
|---|---|
| "Android location access has two parts: when ... and how exact ..." | Supported by c-two-characteristics (e1). |
| "LU-TECH-002" | Episode identifier. Not a claim. |
| Sources (two entries) | Titles, URLs, "page updated 16 Oct 2026" and "retrieved 22 Oct 2026" match the snapshots and the packet. |
| "Android only." | Scope statement. |
| "Background rules apply to Android 10 and newer (on earlier versions, foreground access includes background; the settings-page step is Android 11+)." | The parenthesis is supported by c-pre10-background (e9) and c-android11-settings (e2). The umbrella phrase is made concrete by the parenthesis. Acceptable. |
| "Version means your Android version, not your phone maker's software version." | Explanatory definition, consistent with the sources' "Android N (API level N)" usage. Asserts no Android behaviour. |
| "Menu names can differ by phone and language." | Hedge ("can"). The language part matches the snapshot's localisation sentence (`getBackgroundPermissionOptionLabel()`). |
| "This covers the location permission, not other ways an app might estimate where you are." | Scope statement, hedged ("might"). |

## Length

The narration is 127 words, about 49.2 s at 155 wpm. Per beat, words and speech estimate vs slot:

| Beat | Words | Speech | Slot |
|---|---|---|---|
| Hook | 11 | 4.3 s | 4.5 s |
| Mechanism | 54 | 20.9 s | 21.1 s |
| Takeaway | 26 | 10.1 s | 10.3 s |
| Twist | 36 | 13.9 s | 14.1 s |

The timeline ends at exactly **50.0 s**, which meets the 50 s or less target. Padding is about 0.2 s per beat, so a slower read (for example 145 wpm, about 52.6 s) would overrun. Confirm with the real voice render.

## Optional suggestions (none affects a verdict)

1. c-approximate-applies lists `caption` in `locations`, but no caption line asserts it. Drop it, or accept the over-declaration as conservative.
2. The limitation of c-android11-settings ("Android 10 showed the option in the dialog") relies on an unquoted sentence (request-background-location.txt, lines 51 to 54). Quote it if the limitation is ever shown to viewers.
3. Timing margin is thin (see Length). Re-time against the actual narration audio.

## Other checks

- **Freshness:** every claim is `changing` with `freshUntil: null`. Recheck both pages within 24 h before publication.
- **Page hashes:** `contentSha256` is a hash of the raw HTML, which is not in the repo. I could not recompute it, and verified against the extracted text only.
- **Licence:** the Content License (developer.android.com/license) was not fetched. No on-screen quotation appears beyond the UI label "Allow all the time".
- **Single origin:** both sources share the origin `google-android-developer-docs`. The justification (the platform owner documents its own platform) is acceptable for these narrow technical facts.
- **Untrusted data:** the snapshots contained no instructions directed at reviewers.

## Gate output

Before round-4.json was written:

```
content/pilots/LU-TECH-002: blocked (in-memory check only)
  - missing_ai_verification: claim c-two-characteristics was AI-verified against a different version of the script; re-review this version
  - missing_ai_verification: claim c-foreground-definition was AI-verified against a different version of the script; re-review this version
  - missing_ai_verification: claim c-android11-settings was AI-verified against a different version of the script; re-review this version
  - missing_ai_verification: claim c-approximate-applies was AI-verified against a different version of the script; re-review this version
  - missing_ai_verification: claim c-background-reminder was AI-verified against a different version of the script; re-review this version
  - missing_ai_verification: claim c-pre10-background was AI-verified against a different version of the script; re-review this version
exit=1
```

After round-4.json was written:

```
content/pilots/LU-TECH-002: blocked (in-memory check only)
  - missing_ai_verification: AI verification of claim c-android11-settings asked for changes; apply them and get a fresh review of the revised script
  - missing_ai_verification: AI verification of claim c-approximate-applies asked for changes; apply them and get a fresh review of the revised script
exit=1
```
