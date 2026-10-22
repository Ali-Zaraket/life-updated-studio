# LU-TECH-002: independent AI verification, round 3

Reviewer: `claude-opus-5-5` (independent evidence agent, round 3). This is an AI check. It is **not** a qualified human expert review.
Reviewed: 2026-10-22T10:54:15Z. Checked against `source-text/*.txt` (retrieved 2026-10-22T10:36:27Z; both pages say "Last updated 2026-10-16 UTC").
Script subject hash: `109d66ee76e10c979411df216b051682410218796611caa496c4fd1445668e3c`

I judged the current script and packet on their own. Earlier rounds were used only as context.

## Bottom line

All nine evidence passages (e1 to e9) appear word for word in the snapshots (whitespace-normalised). No claim misstates its source. The script and caption need **no changes**. One ledger fix is required: the e9 passage does not contain the version number its claim relies on. The gate is therefore **blocked** until that fix is made and the claim is reviewed again.

| Claim | Verdict | Reason |
|---|---|---|
| c-two-characteristics | pass | Matches e1. The hook is broad, but beat 2 qualifies it right away |
| c-foreground-definition | pass | Matches e6 and e7. "Running with an ongoing notification" is an acceptable plain-language gloss |
| c-android11-settings | pass | Matches e2 and e8 |
| c-approximate-applies | pass | Matches e3 and e4. The takeaway is hedged ("where it's offered") |
| c-background-reminder | pass | Matches e5. Keeps the "after you allow", "first time" and "schedules" wording |
| c-pre10-background | **pass_with_changes** | The claim says "earlier than 10", but the e9 passage only says "earlier versions of Android" |

## Required change (ledger only, no script or caption change)

**c-pre10-background / e9.** The claim is numeric ("earlier than 10"). Its passage on its own says only "On earlier versions of Android, ...". The Android 10 reference point is in the sentence just before, which is not quoted; only the locator points to it. Replace `e9.supportingPassage` with this verbatim text from request-location-permissions.txt, section "Background location":

> On Android 10 (API level 29) and higher, you must declare the ACCESS_BACKGROUND_LOCATION permission in your app's manifest in order to request background location access at runtime. On earlier versions of Android, when your app receives foreground location access, it automatically receives background location access as well.

The script subject hash covers only the beats and the caption, so this edit does not change it. This claim still needs a fresh AI review after the edit.

## Beat by beat

**Beat 1, hook (0 to 5.0 s).** "An Android app asks for your location. You're actually making two choices." This is supported by e1: each permission has a category and an accuracy. On Android 11+ the pop-up does not offer background, but beat 2 says so within about 15 s, and the caption states the general model. The line is acceptable. The visual is a generic prompt with no real UI text and an on-screen "Illustration" label.

**Beat 2, mechanism (5.0 to 26.3 s).**
- "Foreground: the app is on screen, or running with an ongoing notification." This glosses e6: a visible activity, or a foreground service with a persistent notification. It is accurate enough for a general audience. (For the lead's awareness: an ongoing notification without a foreground service would not count. The wording does not claim it would.)
- "Background: any other time." Matches e7.
- "On Android 11 and newer, background access isn't in the pop-up; it's a separate option in settings." Matches e2 and e8.
- "Second: how exact, precise or approximate." Matches e1.
- "Grant approximate, and the app only gets approximate location, even in the background." Matches e3 and e4.
- The visual matches the narration and is labelled "Illustration".

**Beat 3, takeaway (26.3 to 36.8 s).** "In each app's location permission settings, check whether it's allowed all the time, and pick approximate where it's offered and your exact spot isn't needed." This is advice based on e2, e8, e3 and e4. "Where it's offered" correctly hedges a point the sources do not settle: they do not say which versions or apps offer the approximate choice. The checklist card is a text graphic, not a mock phone screen, so it does not need an illustration label. It quotes the English settings label, and the caption covers localisation.

**Beat 4, twist (36.8 to 51.1 s).** "On Android 10 and newer, after you allow an app all the time, Android schedules a reminder the first time it uses location in the background. A good moment to check it still needs it." Matches e5, and the line does not say when the reminder appears or whether it repeats. The visual is labelled "Illustration — not Android's actual notification".

**Twist logic.**
- The promise ("what exactly are you choosing?") is resolved in beats 2 and 3, before the twist.
- The twist follows from the evidence: it is a consequence of the "all the time" grant.
- Nothing essential is withheld, and there is no engagement appeal.
- The narration does not point to the future inference episode (`endingReferencesRelated: false`, `relatedEpisodeId: null`).

## Caption, line by line

| Line | Status |
|---|---|
| "Android location access has two parts: when (foreground or background) and how exact (precise or approximate)." | Supported by c-two-characteristics (e1). |
| "LU-TECH-002" | Episode identifier. Not a claim. |
| Sources (two entries) | Titles, URLs, "page updated 16 Oct 2026" and "retrieved 22 Oct 2026" match the snapshots and packet. |
| "Android only." | Scope statement. Explanatory text, no claim needed. |
| "Background rules apply to Android 10 and newer (on earlier versions, foreground access includes background; the settings-page step is Android 11+)." | The pre-Android-10 part is supported by **c-pre10-background**, once e9 is extended as required above. "the settings-page step is Android 11+" is supported by c-android11-settings (e2). "Background rules apply to Android 10 and newer" is an umbrella phrase. The parenthesis and c-background-reminder make it concrete. Acceptable. |
| "Version means your Android version, not your phone maker's software version." | Ordinary explanatory text. It defines how the episode uses "version", consistent with the sources' "Android N (API level N)" usage, and asserts no checkable fact about Android behaviour. No claim needed. |
| "Menu names can differ by phone and language." | A hedge that weakens rather than adds an assertion ("can"). Ordinary explanatory text, no claim needed. The language part is backed by the snapshot ("localized to the user's device language preference", request-background-location.txt). The e8 evidence limitation also records this, but no ledger passage quotes it. |
| "This covers the location permission, not other ways an app might estimate where you are." | Scope statement that mirrors the c-approximate-applies limitation. Hedged ("might"). No claim needed. |

## Length

The script has 128 words, about 49.5 s of speech at 155 wpm. Per beat, words and speech estimate vs slot: hook 12 words, 4.6 s vs 5.0 s; mechanism 54 words, 20.9 s vs 21.3 s; takeaway 26 words, 10.1 s vs 10.5 s; twist 36 words, 13.9 s vs 14.3 s. Speech falls within the 25 to 50 s default. The timeline, with about 0.4 s of padding per beat, ends at **51.1 s**, 1.1 s over the default. The brief treats 50 s as a creative starting point, not a hard limit, so this does not affect any verdict (optional fix below).

## Optional suggestions (style or robustness; none affects a verdict)

1. Timeline: trim padding, or drop "actually" from the hook, to end at or under 50.0 s.
2. Ledger: quote "This dialog includes an option to navigate to your app's location permission options on a settings page." (request-background-location.txt, "App targets Android 10 or lower"). This would give "each app's location permission settings" its own passage.
3. Ledger: the c-android11-settings limitation "Android 10 showed the option in the dialog" relies on an unquoted sentence on the same page. Quote it if the limitation is ever shown to viewers.
4. Ledger: quote the `getBackgroundPermissionOptionLabel()` localisation sentence if "language" in the caption is ever treated as a claim.

## Other checks

- **Freshness:** every claim is `changing` with `freshUntil: null`. Recheck both pages within 24 h before publication.
- **Licence:** the Content License (developer.android.com/license) was not fetched. The script shows no on-screen quotation beyond the short UI label "Allow all the time".
- **Single origin:** both sources share the origin `google-android-developer-docs`. The justification given (the platform owner documents its own platform) is acceptable for these narrow technical facts.

## Gate output

Before round-3.json was written:

```
content/pilots/LU-TECH-002: blocked (in-memory check only)
  - missing_ai_verification: claim c-two-characteristics was AI-verified against a different version of the script; re-review this version
  - missing_ai_verification: claim c-foreground-definition was AI-verified against a different version of the script; re-review this version
  - missing_ai_verification: claim c-android11-settings was AI-verified against a different version of the script; re-review this version
  - missing_ai_verification: claim c-approximate-applies was AI-verified against a different version of the script; re-review this version
  - missing_ai_verification: claim c-background-reminder was AI-verified against a different version of the script; re-review this version
  - missing_ai_verification: claim c-pre10-background has no independent AI verification pass
exit=1
```

After round-3.json was written:

```
content/pilots/LU-TECH-002: blocked (in-memory check only)
  - missing_ai_verification: AI verification of claim c-pre10-background asked for changes; apply them and get a fresh review of the revised script
exit=1
```
