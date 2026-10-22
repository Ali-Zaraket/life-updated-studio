# LU-TECH-002 — independent AI verification notes

Reviewer: `claude-opus-5-5` (independent evidence agent, Claude Code). This is an AI check. It is **not** a qualified human expert review.
Reviewed: 2026-10-22T10:40:48Z, against `source-text/*.txt` (snapshots retrieved 2026-10-22T10:36:27Z, pages last updated 2026-10-16).

## Bottom line

All four ledger claims match their sources word for word and are worded correctly. **The script still needs edits before release.** Every verdict is `pass_with_changes`. The gate reported `verified` because `pass_with_changes` counts as passing (`packages/content/src/gate.ts:64`). That result does not mean the edits below have been made.

## Evidence passages (verbatim check, whitespace-normalised)

| Evidence | Claim | Source file | Found verbatim |
|---|---|---|---|
| e1 | c-two-characteristics | request-location-permissions.txt | yes |
| e2 | c-android11-settings | request-background-location.txt | yes |
| e3 | c-approximate-applies | request-location-permissions.txt | yes |
| e4 | c-approximate-applies | request-background-location.txt | yes |
| e5 | c-background-reminder | request-location-permissions.txt | yes |

Note: `contentSha256` in packet.json does not match the sha256 of the `.txt` snapshots (txt: `6b85a660…` / `588e4387…`). It is presumably a hash of the raw fetched page. I could not check it independently.

## Per-claim verdicts

- **c-two-characteristics — pass_with_changes.** The claim is fine. The script's foreground explanation is not in the ledger, and it leaves out the main exception (see beat 3).
- **c-android11-settings — pass_with_changes.** The claim and its version numbers are correct. Change "switch" to "option", and make the takeaway something a viewer can act on.
- **c-approximate-applies — pass_with_changes.** The claim is fine. "That's all the app gets" is ambiguous. "Choose approximate" assumes the choice exists, but the sources never say on which Android versions it does.
- **c-background-reminder — pass_with_changes.** The claim is fine. Change "sends" to "schedules". "Your moment to decide again" goes beyond the source. The illustrative notification wording must be labelled on screen.

## Beat-by-beat

**Beat 1 (hook):** "You're actually making two choices." The source describes two characteristics of a *permission*. Treating them as two *user choices* is fair on current Android, with two exceptions: (a) on Android 11+ the background choice is not in the pop-up; (b) the source says that before Android 10, "when your app receives foreground location access, it automatically receives background location access as well." Keep the hook and add a version limit to the caption (below).

**Beat 2 (problem):** The visual "Thumb taps 'Allow'" shows a button label the evidence does not document for today's dialog. Use an unlabelled button. Optional softer line: "Tap through too fast, and you might not notice which of the two you picked."

**Beat 3 (mechanism):**
- "In the foreground, roughly while you're using the app": **not a fair enough gloss, and not in the ledger.** The source counts as foreground (1) a visible activity, or (2) a running foreground service with a persistent notification, and says the app "retains access when it's placed in the background, such as when the user presses the Home button … or turns their device's display off." Add a claim `c-foreground-definition` with that passage. Suggested line: **"In the foreground: while the app is on screen, or while it shows an ongoing notification. Or in the background: any other time."**
- "On Android 11 and newer, the pop-up can't grant background access; that's a separate switch on a settings page": the source says the dialog "doesn't include the Allow all the time option" and figure 7 is "an option called Allow all the time". Suggested: **"On Android 11 and newer, the pop-up doesn't offer background access; that's a separate option on a settings page."** Target-SDK check: when an app targets Android 10 or lower, the dialog "includes an option to navigate to … a settings page". The grant still happens in settings, so the claim holds either way.
- "Grant approximate, and that's all the app gets, even in the background": a viewer could hear this as "the app gets no other data". Suggested: **"Grant approximate, and the app only gets approximate location, even in the background."**

**Beat 4 (takeaway):** As written it is not actionable: it says what to check but not where. Suggested: **"So check which apps are set to 'Allow all the time' in their location permission settings, and choose approximate where your phone offers it and your exact spot isn't needed."** The source supports "Allow all the time" only as the example (localised) label of the settings option. "Where your phone offers it" is there because neither snapshot says which Android versions let the user pick approximate. My background understanding is Android 12 / API 31+, and only when the app asks for precise location, but that is **not evidenced in this packet**. Either add an official source and a version-qualified claim, or keep the hedge.

**Beat 5 (twist):**
- "the first time an app uses your location in the background, Android sends a reminder": the source says "after the user grants background location access, the system **schedules** a notification". Suggested: **"And on Android 10 and newer, after you allow location all the time, the first time the app uses it in the background, Android schedules a reminder notification."**
- "That's your moment to decide again": the source says only that the notification "reminds the user". It does not say the notification offers a decision. Suggested: **"It's a good moment to check whether that app still needs it."**
- Visual: the notification text is invented (figure 8's real wording is not in the snapshot). "(illustrative wording)" must be shown **on screen**, e.g. "Illustration — not Android's actual notification". The card should not look enough like system UI to pass as a screenshot. The same goes for the beat 3 diagram and the beat 1 prompt.
- Twist logic: acceptable. It is a relevant consequence that follows from the evidence. The main promise is resolved in beats 3–4 first, nothing essential is withheld, and the ending does not point to an unpublished Reel (`endingReferencesRelated: false`). The `nextQuestion` (inferring location from other signals) correctly needs its own evidence later.

## Caption

The sources are identified by publisher, title, update date and retrieval date. Consider adding the two URLs. "Android only" covers iPhone viewers. Suggested limits line:

> Limits: Android only. Background rules apply to Android 10 and newer (older versions include background with foreground; the settings-page step is Android 11+). Version means your Android version, not your phone maker's software version. Menu names vary by phone maker. This covers the location permission, not other ways an app might estimate where you are.

## Packet / ledger nits (lead to decide)

- `isNumeric: true` is set on three claims whose only numbers are Android version numbers. Confirm this is intended.
- `publishedAt` holds the page's "last updated" date, not a publication date. The caption says "updated", which is correct.
- Add `c-foreground-definition`, plus a version-qualified approximate-choice claim if beat 4 keeps "choose approximate" without the hedge.
- Licence: the on-screen quotation licence (developer.android.com/license) has not been confirmed (already noted in the packet).

## Gate behaviour (for the lead)

`env -u DATABASE_URL npx tsx apps/worker/src/pilot-cli.ts content/pilots/LU-TECH-002` printed: `content/pilots/LU-TECH-002: verified (in-memory check only)`. `pass_with_changes` is treated as passing, and the AI reviews have `episodeVersionId: null`. So the gate does not enforce that the requested edits are made, and it does not tie this review to a script version. After the script is revised, it should be re-reviewed against the new version.
