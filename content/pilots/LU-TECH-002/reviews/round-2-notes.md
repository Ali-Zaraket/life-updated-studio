# LU-TECH-002: independent AI verification, round 2

Reviewer: `claude-opus-5-5` (independent evidence agent, round 2). This is an AI check. It is **not** a qualified human expert review.
Reviewed: 2026-10-22T10:49:40Z. Checked against `source-text/*.txt` (retrieved 2026-10-22T10:36:27Z, pages last updated 2026-10-16).
Script subject hash: `7d1a4e7d17d92408f534ea69a020011de46cd16fe144bd36ba32029a5ba5d547`

## Bottom line

All six evidence passages (e1–e6) appear word for word in the snapshots (whitespace-normalised). All five claims are worded correctly. The script is close, but **it is not ready to publish**. All five verdicts are `pass_with_changes`. The gate now reports **blocked** for this reason (output below). No claim gets `fail`: nothing misstates the sources. The problems are an inverted gloss, a claim in the caption that has no ledger entry, a few overreaches, and the length.

| Claim | Verdict | Main reason |
|---|---|---|
| c-two-characteristics | pass_with_changes | First caption line does not hold on Android 11+; "Illustration" labels not marked as on-screen; length |
| c-foreground-definition | pass_with_changes | "showing an ongoing notification" turns the source's logic around; "background is any other time" has no evidence |
| c-android11-settings | pass_with_changes | Takeaway implies a phone-wide list; "older versions" caption claim has no ledger entry; "phone maker" has no evidence |
| c-approximate-applies | pass_with_changes | Takeaway line needs rewording; extend e4 so the user's choice itself has evidence |
| c-background-reminder | pass_with_changes | "after the user grants" is missing; ledger limitation "sent once" overstates the source |

## Beat by beat

**Beat 1 (hook):** "You're actually making two choices." Acceptable as a hook. Beat 3 adds the Android 11 qualifier right away. The visual is a mock permission prompt. It ends with "Illustration.", but unlike beat 5 it does not say this is an on-screen label. Change it to: `... Illustration. On-screen label: 'Illustration'.` (Apply the same change to beats 2 and 3.)

**Beat 2 (problem):** "Tap yes too fast, and you can miss what you gave away." This line makes no factual claim and adds no evidence. It repeats the hook and costs 5 s. **Recommended: cut this beat** (see Length).

**Beat 3 (mechanism):**
- "Foreground means the app is on screen or showing an ongoing notification": the source says a running *foreground service* is foreground, and that "the system raises user awareness by showing a persistent notification". The notification is a sign of the service. It does not define foreground. Any app can show an ongoing notification. Rewrite: **"Foreground: the app is on screen, or running with an ongoing notification. Background: any other time."**
- "background is any other time": this is a checkable claim, and no evidence in the packet covers it. Add this passage (request-location-permissions.txt, "Background location"): *"The system considers your app to be using background location if it accesses the device's current location in any situation other than the ones described in the foreground location section."*
- "On Android 11 and newer, the pop-up doesn't offer background access; that's a separate option in settings": supported by e2. It also holds for apps that target Android 10 or lower: their dialog only links to the settings page. The tighter version in the full rewrite below is optional: "background access isn't in the pop-up; it's a separate option in settings".
- "Grant approximate, and the app only gets approximate location, even in the background": supported by e3 and e4. No change.
- Visual: change "app on screen / ongoing notification = foreground" to "app on screen / running with ongoing notification = foreground".

**Beat 4 (takeaway):** "So in your location settings, check which apps are allowed all the time" suggests a single list for the whole phone. The sources only document each app's own settings page ("your app's location permission options on a settings page"). Rewrite: **"So in each app's location permission settings, check whether it's allowed all the time, and pick approximate where it's offered and your exact spot isn't needed."** Keep "where it's offered": neither snapshot says which Android versions or apps offer the approximate option. The label "Allow all the time" on the settings page comes from Figure 7's caption, not from e2. Add it as evidence and note that the label is localized. The checklist card is a text graphic, not a mock of the phone's screen, so it needs no illustration label.

**Beat 5 (twist):** "the first time such an app uses your location in the background" leaves out the source's anchor, "for the first time **after the user grants** background location access". A viewer who has just found an app that was already allowed all the time (beat 4) may wait for a reminder that will not come. Rewrite: **"And on Android 10 and newer, after you allow an app all the time, Android schedules a reminder the first time it uses location in the background. A good moment to check it still needs it."** "Schedules" matches the source. The visual has the correct on-screen label ("Illustration — not Android's actual notification").

**Twist logic:** OK. The main promise (what you are choosing) is resolved in beats 3–4 before the twist. The twist is a consequence that follows from e5. Nothing essential is withheld. There is no engagement appeal. `endingReferencesRelated: false`, and the narration does not point to the future inference episode.

## Caption

- First line: "When an Android app asks for your location, you're making two choices: when (foreground or background) ...". On Android 11+ the pop-up does not offer background at all, and people often read the caption on its own. Rewrite: **"Android location access has two parts: when (foreground or background) and how exact (precise or approximate)."**
- Limits: "older versions include background with foreground" is a checkable claim with no ledger entry. Add a claim with this passage (request-location-permissions.txt, "Background location"): *"On earlier versions of Android, when your app receives foreground location access, it automatically receives background location access as well."*
- "Menu names vary by phone maker": not in the sources. The sources only support language localization. Use the hedge **"Menu names can differ by phone and language."**
- "Version means your Android version, not your phone maker's software version": this is an author clarification, not a sourced fact. It is acceptable as written.
- Sources: publisher, title, URL, update date and retrieval date are all present and match the snapshots ("Last updated 2026-10-16 UTC").

## Ledger fixes (lead)

1. c-foreground-definition: add the background-definition passage above, and extend the claim text (or add a separate claim).
2. New claim: Android versions before 10 grant background access together with foreground (passage above).
3. c-android11-settings: add the Figure 7 caption as evidence: *"Settings page includes an option called Allow all the time, which grants background location access."*
4. c-approximate-applies: start e4 one sentence earlier: *"If the user requests approximate location, the user's choices in the location permissions dialog also apply to background location."*
5. c-background-reminder limitation: replace "the reminder is sent once, on first background use" with: "Android 10 (API level 29) and higher. The source describes one notification scheduled on the first background access after the grant; it does not say when it is shown or whether other reminders follow."
6. Freshness: all claims are `changing` with `freshUntil: null`. Recheck both pages within 24 h before publication.

## Length

The current script is 138 words: about 53 s at 155 wpm, and the timeline runs to 55.4 s. The brief's default is 25–50 s. The mechanism needs roughly 21 s, so going a little over could be defended, but beat 2 adds nothing. With beat 2 cut and the rewrites above, the script is 128 words, about 49.5 s:

1. Hook (0–5): "An Android app asks for your location. You're actually making two choices."
2. Mechanism (5–26): "First: when. Foreground: the app is on screen, or running with an ongoing notification. Background: any other time. On Android 11 and newer, background access isn't in the pop-up; it's a separate option in settings. Second: how exact, precise or approximate. Grant approximate, and the app only gets approximate location, even in the background."
3. Takeaway (26–36): "So in each app's location permission settings, check whether it's allowed all the time, and pick approximate where it's offered and your exact spot isn't needed."
4. Twist (36–50): "And on Android 10 and newer, after you allow an app all the time, Android schedules a reminder the first time it uses location in the background. A good moment to check it still needs it."

The revised script must be reviewed again. This review is bound to the current subject hash.

## Gate output

Before round-2 was written (round-1 reviews were bound to an older script):

```
content/pilots/LU-TECH-002: blocked (in-memory check only)
  - missing_ai_verification: claim c-two-characteristics was AI-verified against a different version of the script; re-review this version
  - missing_ai_verification: claim c-foreground-definition has no independent AI verification pass
  - (same "different version" line for c-android11-settings, c-approximate-applies, c-background-reminder)
```

After round-2.json was written:

```
content/pilots/LU-TECH-002: blocked (in-memory check only)
  - missing_ai_verification: AI verification of claim c-two-characteristics asked for changes; apply them and get a fresh review of the revised script
  - (same line for c-foreground-definition, c-android11-settings, c-approximate-applies, c-background-reminder)
```

The CLI exits with status 0 even when the result is `blocked`. Anything that relies on the exit code would treat a blocked episode as a success. The lead should decide whether a block should return a non-zero exit code.
