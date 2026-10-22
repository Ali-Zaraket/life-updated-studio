# Review package — LU-TECH-002 “Your phone's two location choices” (Android)

**Status:** `verified` — evidence and creative gates pass, and an independent AI check (round 7, `claude-opus-5-5`) passed all six claims against this exact script and evidence. **Not approved and not publishable yet:** it needs your narrator voice, a final render, a source recheck within 24 h of publishing, and your approval in the studio.

Format: everyday mystery · Pillar: technology · Risk: low · Length: ~49 s of speech (127 words at ~155 wpm) · Fixture: no — real sources.

## Script

| Time | Beat | Narration | Visual | Claims |
|---|---|---|---|---|
| 0.0–4.5 s | hook | An Android app wants your location. That access has two parts. | Generic permission prompt (no real UI text) splits into two labelled panels: WHEN and HOW EXACT. On-screen label: 'Illustration'. | c-two-characteristics |
| 4.5–25.6 s | mechanism | First: when. Foreground: the app is on screen, or running with an ongoing notification. Background: any other time. On Android 11 and newer, background access isn't in the pop-up; it's a separate option in settings. Second: how exact, precise or approximate. Grant approximate, and the app only gets approximate location, even in the background. | Diagram: WHEN dial (app on screen / running with ongoing notification = foreground; any other time = background, with a settings-page icon). HOW EXACT dial (precise pin vs. wide circle). On-screen label: 'Illustration'. | c-two-characteristics, c-foreground-definition, c-android11-settings, c-approximate-applies |
| 25.6–35.9 s | takeaway | So in each app's location permission settings, check whether it's allowed all the time, and pick approximate where it's offered and your exact spot isn't needed. | Checklist card (text graphic, not a phone screen): 1) 'Allow all the time'? 2) approximate where offered and enough. | c-android11-settings, c-approximate-applies |
| 35.9–50.0 s | twist | And on Android 10 and newer, after you allow an app all the time, Android schedules a reminder the first time it uses location in the background. A good moment to check it still needs it. | Stylised card with on-screen label 'Illustration — not Android's actual notification'; must not look like a real screenshot. | c-background-reminder |

## Caption

```
Android location access has two parts: when (foreground or background) and how exact (precise or approximate).
LU-TECH-002

Sources:
- Android Developers (Google), "Request location permissions", developer.android.com/develop/sensors-and-location/location/permissions (page updated 16 Oct 2026, retrieved 22 Oct 2026)
- Android Developers (Google), "Request background location", developer.android.com/develop/sensors-and-location/location/permissions/background (page updated 16 Oct 2026, retrieved 22 Oct 2026)
Limits: Android only. Background rules apply to Android 10 and newer (on earlier versions, foreground access includes background; the settings-page step is Android 11+). Version means your Android version, not your phone maker's software version. Menu names can differ by phone and language. This covers the location permission, not other ways an app might estimate where you are.
```

## Claims and evidence

### `c-two-characteristics` — supported

Android location permissions combine two characteristics: a category (foreground or background) and an accuracy (precise or approximate).

*Limitations:* Describes the permission model; exact on-screen wording varies by Android version and phone maker.

- **e1** (supports) — Request location permissions, Google (Android Developers), Section: Types of location access:
  > Each permission has a combination of the following characteristics: Category: Either foreground location or background location. Accuracy: Either precise location or approximate location.

### `c-android11-settings` — supported

On Android 11 and higher, the permission dialog does not include the 'Allow all the time' option; users must enable background location on a settings page.

*Limitations:* Applies to Android 11 (API level 30) and higher; Android 10 showed the option in the dialog.

- **e2** (supports) — Request background location, Google (Android Developers), Section: Permission dialog contents depend on target SDK version:
  > On Android 11 (API level 30) and higher, however, the system dialog doesn't include the Allow all the time option. Instead, users must enable background location on a settings page, as shown in figure 7.
- **e8** (supports) — Request background location, Google (Android Developers), Figure 7 caption:
  > Figure 7. Settings page includes an option called Allow all the time, which grants background location access.
- **e10** (supports) — Request background location, Google (Android Developers), Section: App targets Android 10 or lower:
  > This dialog includes an option to navigate to your app's location permission options on a settings page.
- **e11** (context) — Request background location, Google (Android Developers), Section: Permission dialog contents depend on target SDK version:
  > When a feature in your app requests background location on a device that runs Android 10 (API level 29), the system permissions dialog includes an option named Allow all the time. If the user selects this option, the feature in your app gains background location access.

### `c-approximate-applies` — supported

If the user grants only approximate location, the app has only approximate location, including in the background.

*Limitations:* Concerns the location permission itself; it does not cover other ways an app might estimate location.

- **e3** (supports) — Request location permissions, Google (Android Developers), Section: Accuracy (paragraph after the Approximate and Precise definitions):
  > If the user grants the approximate location permission, your app only has access to approximate location, regardless of which location permissions your app declares.
- **e4** (supports) — Request background location, Google (Android Developers), Section: User can affect background location accuracy:
  > If the user requests approximate location, the user's choices in the location permissions dialog also apply to background location. In other words, if the user grants your app the ACCESS_BACKGROUND_LOCATION permission but grants only approximate location access in the foreground, your app has only approximate location access in the background as well.

### `c-background-reminder` — supported

On Android 10 and higher, the first time an app accesses location in the background after the user grants background access, the system schedules a notification reminding the user they allowed location all the time.

*Limitations:* Android 10 (API level 29) and higher. The source describes one notification scheduled on the first background access after the grant; it does not say when it is shown or whether other reminders follow.

- **e5** (supports) — Request location permissions, Google (Android Developers), Section: Reminder of background location grant:
  > On Android 10 (API level 29) and higher, when a feature in your app accesses device location in the background for the first time after the user grants background location access, the system schedules a notification to send to the user. This notification reminds the user that they've allowed your app to access device location all the time.

### `c-foreground-definition` — supported

Android treats an app as using foreground location when one of its activities is visible or when it is running a foreground service, which shows a persistent notification; with a foreground service it keeps access after the user presses Home or turns the screen off. Any other location access counts as background.

*Limitations:* Developer-facing definition; what users see in settings may be labelled differently.

- **e6** (supports) — Request location permissions, Google (Android Developers), Section: Foreground location:
  > The system considers your app to be using foreground location if a feature of your app accesses the device's current location in one of the following situations: An activity that belongs to your app is visible. Your app is running a foreground service. When a foreground service is running, the system raises user awareness by showing a persistent notification. Your app retains access when it's placed in the background, such as when the user presses the Home button on their device or turns their device's display off.
- **e7** (supports) — Request location permissions, Google (Android Developers), Section: Background location:
  > The system considers your app to be using background location if it accesses the device's current location in any situation other than the ones described in the foreground location section.

### `c-pre10-background` — supported

On Android versions earlier than 10, an app that receives foreground location access automatically receives background location access as well.

*Limitations:* Applies to Android 9 and earlier.

- **e9** (supports) — Request location permissions, Google (Android Developers), Section: Background location (after the Android 10 manifest requirement):
  > On Android 10 (API level 29) and higher, you must declare the ACCESS_BACKGROUND_LOCATION permission in your app's manifest in order to request background location access at runtime. On earlier versions of Android, when your app receives foreground location access, it automatically receives background location access as well.

## Sources

- Request location permissions — Google (Android Developers) — https://developer.android.com/develop/sensors-and-location/location/permissions — page last updated 2026-10-16, last rechecked 2026-10-22T11:13:04.482Z
- Request background location — Google (Android Developers) — https://developer.android.com/develop/sensors-and-location/location/permissions/background — page last updated 2026-10-16, last rechecked 2026-10-22T11:13:04.482Z

Both sources come from one origin (Google's Android documentation). Each claim records why that is acceptable: the platform's own documentation is authoritative for how the platform behaves.

## How it was checked

Seven independent review rounds (each a fresh reviewer that did not write the script; notes in `content/pilots/LU-TECH-002/reviews/`):

| Round | Outcome | Main findings fixed |
|---|---|---|
| 1 | changes | Foreground gloss incomplete; "sends" vs "schedules"; illustrative notification needed labelling; caption limits — **and a gate bug**: `pass_with_changes` was accepted and reviews were not tied to the script |
| 2 | changes | Inverted foreground gloss; caption claim without a ledger entry; per-app settings wording; reminder timing; length |
| 3 | 5 pass, 1 change | A quoted passage lacked its "Android 10" sentence |
| 4 | 4 pass, 2 changes | Two evidence locators pointed to the wrong section |
| 5 | all pass | — (then the review binding was extended to evidence, voiding it by design) |
| 6 | 5 pass, 1 change | Hook overstated "two choices" for older Android versions |
| 7 | **all pass** | — |

Gate improvements that came out of this: AI reviews are now bound to the exact script **and** evidence (`subjectSha256`), `pass_with_changes` blocks until re-reviewed, and source rechecks (`pnpm pilot:recheck`) refresh freshness without voiding reviews.

## Before this can be published (your steps)

1. Choose the narrator (`pnpm audition`, studio → Voice). Then the final render uses that voice; re-time against the real audio if it runs over 50 s.
2. `pnpm pilot:load content/pilots/LU-TECH-002` on your machine, then open the episode in the studio, watch the preview, read the evidence.
3. Within 24 h of publishing: `pnpm pilot:recheck content/pilots/LU-TECH-002` (all passages must still be on the live pages).
4. Approve in the studio with a publish window. Publishing stays MOCK until Instagram is connected and live publishing is authorised.

## Open notes from the reviewers (optional, not blocking)

- A caption line saying the precise/approximate choice isn't offered on every Android version would make "where it's offered" explicit (needs no version number unless an official source is added).
- Claims' `locations` don't list `visual`; matters only for corrections sweeps.
- The Android Developers content licence was not fetched; the script paraphrases and only shows the on-screen label "Allow all the time".
- This is AI verification, not qualified human review (not required for a low-risk technical topic).
