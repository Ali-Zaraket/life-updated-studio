# LU-TECH-002: independent AI verification, round 5

Reviewer: `claude-opus-5-5` (independent evidence agent, round 5). This is an AI check. It is **not** a qualified human expert review.
Reviewed: 2026-10-22T11:03:16Z, against `source-text/*.txt` (retrieved 2026-10-22T10:36:27Z; both pages say "Last updated 2026-10-16 UTC").
Subject hash (script + claim ledger, `pnpm -s pilot:subject`): `ffb2c956dee3973e577e801454ac696bd787609f1058ace6a741d16633d9880d`

I judged the current script and packet on their own merits. Earlier rounds were context only; I re-checked the round-4 locator fixes against the snapshots rather than assuming them.

## Bottom line

All eleven evidence passages (e1 to e11) appear word for word in the snapshots, exactly once each (whitespace-normalised). Every locator names a real heading (or the Figure 7 caption) that contains the passage. Every beat, visual label and caption line stays within its cited claims. **No required changes.** All six claims: `pass`.

| Claim | Verdict | Evidence |
|---|---|---|
| c-two-characteristics | pass | e1 |
| c-foreground-definition | pass | e6, e7 |
| c-android11-settings | pass | e2, e8, e10 (+ e11 context) |
| c-approximate-applies | pass | e3, e4 |
| c-background-reminder | pass | e5 |
| c-pre10-background | pass | e9 |

## Passage and locator check

Lines refer to `request-location-permissions.txt` (LP) and `request-background-location.txt` (BG).

| Ev. | Verbatim | Lines | Locator | Heading in source | Correct? |
|---|---|---|---|---|---|
| e1 | yes | LP 46-48 | Types of location access | LP 45 | yes |
| e2 | yes | BG 55-57 | Permission dialog contents depend on target SDK version | BG 50 | yes (round-4 fix verified) |
| e3 | yes | LP 144-146 | Accuracy (paragraph after the Approximate and Precise definitions) | LP 128; Approximate 130, Precise 137 | yes (round-4 fix verified) |
| e4 | yes | BG 82-86 | User can affect background location accuracy | BG 81 | yes |
| e5 | yes | LP 152-156 | Reminder of background location grant | LP 151 | yes |
| e6 | yes | LP 57-65 | Foreground location | LP 49 | yes |
| e7 | yes | LP 110-112 | Background location | LP 101 | yes |
| e8 | yes | BG 47-49 | Figure 7 caption | (figure caption) | yes |
| e9 | yes | LP 115-119 | Background location (after the Android 10 manifest requirement) | LP 101 | yes; parenthetical slightly stale (optional note 1) |
| e10 | yes | BG 76-78 | App targets Android 10 or lower | BG 75 | yes |
| e11 | yes | BG 51-54 | Permission dialog contents depend on target SDK version | BG 50 | yes; stance `context`, backs the c-android11-settings limitation |

## Beat by beat

**Hook (0-4.5 s).** "An Android app asks for your location. You're making two choices." Within e1. On Android 11+ the background half of "when" is not in the pop-up; beat 2 says so straight away, so the hook does not mislead. Visual: generic prompt, no real UI text, labelled "Illustration".

**Mechanism (4.5-25.6 s).**
- "Foreground: the app is on screen, or running with an ongoing notification." Accurate gloss of e6 (visible activity, or foreground service with a persistent notification).
- "Background: any other time." e7.
- "On Android 11 and newer, background access isn't in the pop-up; it's a separate option in settings." e2, e8; also consistent with e10 (dialog for apps targeting 10 or lower only links to settings).
- "Second: how exact, precise or approximate." e1.
- "Grant approximate, and the app only gets approximate location, even in the background." e3, e4.
- Visual mirrors narration; labelled "Illustration".

**Takeaway (25.6-35.9 s).** "So in each app's location permission settings, check whether it's allowed all the time, and pick approximate where it's offered and your exact spot isn't needed." Advice grounded in e10 (per-app location permission options on a settings page), e8 ("Allow all the time" label) and e3/e4. "Where it's offered" hedges availability, which the sources do not settle. Checklist is a text card, not a phone screen.

**Twist (35.9-50.0 s).** "And on Android 10 and newer, after you allow an app all the time, Android schedules a reminder the first time it uses location in the background. A good moment to check it still needs it." Within e5; it does not say when the notification is shown or whether it repeats. Visual labelled "Illustration — not Android's actual notification".

**Twist logic.** The promise ("what exactly are you choosing?") is resolved in beats 2-3 before the twist. The twist is a consequence of the "all the time" grant, so it follows from the evidence. No caveat or instruction is withheld; no engagement appeal. The ending does not point to another Reel (`endingReferencesRelated: false`, `relatedEpisodeId: null`); the next question lives only in link metadata, marked as a future episode.

## Caption, line by line

| Line | Status |
|---|---|
| "Android location access has two parts: when (foreground or background) and how exact (precise or approximate)." | c-two-characteristics (e1). |
| "LU-TECH-002" | Identifier, not a claim. |
| Sources (two entries) | Titles, URLs, "page updated 16 Oct 2026", "retrieved 22 Oct 2026" match snapshots and packet. |
| "Android only." | Scope. |
| "Background rules apply to Android 10 and newer (on earlier versions, foreground access includes background; the settings-page step is Android 11+)." | Parenthesis supported by e9 and e2; it makes the umbrella phrase concrete. |
| "Version means your Android version, not your phone maker's software version." | Definition consistent with the sources' "Android N (API level N)" usage; asserts no behaviour. |
| "Menu names can differ by phone and language." | Hedged; language part matches the localisation sentence (BG 69-70). |
| "This covers the location permission, not other ways an app might estimate where you are." | Scope, hedged. |

## Length

127 narration words, about 49.2 s at 155 wpm; timeline ends at 50.0 s (meets the 50 s or less target).

| Beat | Words | Speech @155 wpm | Slot |
|---|---|---|---|
| Hook | 11 | 4.3 s | 4.5 s |
| Mechanism | 54 | 20.9 s | 21.1 s |
| Takeaway | 26 | 10.1 s | 10.3 s |
| Twist | 36 | 13.9 s | 14.1 s |

## Required changes

None.

## Optional suggestions (none affects a verdict)

1. **e9 locator parenthetical.** "(after the Android 10 manifest requirement)" was accurate when e9 quoted only the "earlier versions" sentence; since round 4 the passage includes the requirement itself. "(paragraph with the Android 10 manifest requirement)" would be more exact. Section is right and the passage is unique, so this is not an accuracy error.
2. **`locations` omits `visual`.** The hook/mechanism dials (c-two-characteristics, c-foreground-definition, c-android11-settings, c-approximate-applies) and the takeaway's "'Allow all the time'?" label (c-android11-settings) depict ledger claims, but no claim lists `visual`. The visuals add nothing beyond the claims bound to those beats via `claimIds`, and nothing in the code uses `locations`, so I did not treat it as blocking. The lead should decide whether `locations` must be exhaustive (it would matter for a corrections sweep).
3. **Timing margin is about 0.2 s per beat.** A 145 wpm read would run about 52.6 s. Re-time against the real voice render.

## Other checks

- **Freshness:** every claim is `changing`, `freshUntil: null`. Recheck both pages within 24 h before publication.
- **Page hashes:** `contentSha256` is a hash of raw HTML that is not in the repo; I could not recompute it and verified against the extracted text only.
- **Licence:** Content License not fetched; no on-screen quotation beyond the UI label "Allow all the time".
- **Single origin:** both sources share origin `google-android-developer-docs`; the justification (platform owner documents its own platform) is acceptable for these narrow technical facts.
- **Untrusted data:** the snapshots contained no instructions aimed at reviewers.

## Gate output

Before round-5.json was written:

```
content/pilots/LU-TECH-002: blocked (in-memory check only)
  - missing_ai_verification: claim c-two-characteristics was AI-verified against a different version of the script or its evidence; re-review this version
  - missing_ai_verification: claim c-foreground-definition was AI-verified against a different version of the script or its evidence; re-review this version
  - missing_ai_verification: claim c-android11-settings was AI-verified against a different version of the script or its evidence; re-review this version
  - missing_ai_verification: claim c-approximate-applies was AI-verified against a different version of the script or its evidence; re-review this version
  - missing_ai_verification: claim c-background-reminder was AI-verified against a different version of the script or its evidence; re-review this version
  - missing_ai_verification: claim c-pre10-background was AI-verified against a different version of the script or its evidence; re-review this version
exit=1
```

After round-5.json was written:

```
content/pilots/LU-TECH-002: verified (in-memory check only)
exit=0
```

This gate result is an in-memory evidence/review check only. It is not owner approval and does not authorise publication; the owner remains the sole release approver, and both pages must be rechecked for freshness before release.
