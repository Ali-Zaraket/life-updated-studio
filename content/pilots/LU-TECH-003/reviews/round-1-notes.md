# LU-TECH-003 — independent AI verification, round 1

Reviewer: `claude-opus-5-5` (independent evidence agent, round 1). This is an AI check. It is **not** a qualified human review.
Reviewed: 2026-10-26T11:33Z, against `source-text/*.txt` (snapshots retrieved 2026-10-26T11:28Z).
Subject hash: `77f44ec5548d55af88dec14c05e5c6a2e61b8fedcf8ddf6452b2f7f3eac7294d`. I recomputed it with `pilot-subject.ts` and it matches.

## Bottom line

**Not publishable as written.** All 9 evidence passages appear verbatim, and every number (3/18/36 months, 36 months = 3 years) matches the sources. But the twist (beat 6) states something the cited Google page contradicts. "At the longest, that's three years of places" is false: auto-delete can be switched off, and then Google says the Timeline is kept "until you delete it". "It's on your phone right now" contradicts Google's "Timeline is off by default ... can only be turned on if you opt in". The script also leaves out three caveats a viewer needs:

- Timeline is off by default.
- Optional backups put an encrypted copy on Google's servers.
- Turning Timeline off is not the same as deleting it.

On iPhone, "Look first" is not supported by these sources: the Apple pages document viewing the list only on a Mac.

Verdicts: 1 `pass`, 4 `pass_with_changes`, 1 `fail`. Under `gate.ts` (line ~318), a `pass_with_changes` does not clear the claim until the script changes and is re-reviewed. Any edit to the beats, caption or ledger changes the subject hash, so a round 2 review is needed.

## Evidence passages (verbatim, whitespace- and quote-normalised as in `source-check.ts`)

| Evidence | Claim | Source | Verbatim | Supports claim as worded |
|---|---|---|---|---|
| e1 | c-iphone-keeps-places | src-apple-legal-location | yes | yes |
| e2 | c-iphone-encrypted | src-apple-legal-location | yes | yes |
| e3 | c-iphone-setting-path | src-apple-safety-location | yes | yes (turn-off path) |
| e4 | c-android-timeline-saves | src-google-timeline-android | yes | yes |
| e5 | c-android-timeline-saves | src-google-timeline-android | yes | yes |
| e6 | c-android-timeline-path | src-google-timeline-android | yes | yes (path to Timeline) |
| e7 | c-android-timeline-path | src-google-timeline-android | yes | **no**. A truncated fragment of the turn-*on* steps; it does not support "can be turned off". Replace (see below). |
| e8 | c-autodelete-options | src-google-timeline-android | yes | yes |
| e9 | c-autodelete-options | src-google-timeline-ios | yes | yes |

Snapshot hashes: the sha256 of the normalised Apple snapshots matches `contentSha256`. **The two Google snapshots do not match** (I computed `27c2496d…` for android and `542586ed…` for ios). Google Help pages carry a per-request numeric token near the end (`13050383224520991119`, `8175805399780203726`), so the "stable across requests" note in `provenance` does not hold for these pages, and the stored snapshot is not the text that was hashed. Passages were checked against the snapshots on disk.

The Apple legal snapshot ends with `2026-02-11`, which is probably the page date. `publishedAt` is null; the lead could set it.

## Per-claim verdicts

- **c-iphone-keeps-places: pass_with_changes.** The claim is fine. Beat 2 drops "recently" and the "when the setting is on" condition.
- **c-iphone-encrypted: pass.** "Apple says it can't read yours" is attributed, scoped and exact. Keep "Apple says".
- **c-iphone-setting-path: pass_with_changes.** The path is exact. "Look first" is unsupported for iPhone.
- **c-android-timeline-saves: pass_with_changes.** Beat 3 is fair. Beat 4 "Google keeps it on your phone" is unattributed and leaves out backup. The off-by-default caveat is missing. The "diary" analogy is not in the ledger. The beat 4 visual is unlabelled.
- **c-android-timeline-path: pass_with_changes.** Replace e7. Turning off is not deleting; say so. Use "profile picture or initial".
- **c-autodelete-options: fail.** "At the longest, three years" and "It's on your phone right now" are contradicted by the source. The ledger limitation is also wrong.

## Beat-by-beat

**Beat 1 (hook):** "Your phone may be keeping a map of the places you go. Including this one." **Acceptable** because of "may". The bedroom framing implies home. Google says saved home/work addresses "show up on Timeline", e5 covers regularly saved precise locations, and e1 covers places recently visited. This holds only if beats 2–3 state the conditions (setting on; Google off by default). The visual is labelled Illustration. OK.

**Beat 2 (mechanism):**
- Old: "On iPhone, Apple says it keeps track of where you've been, how often, when, and your routes."
- New: **"On iPhone, with Significant Locations & Routes on, Apple says it keeps track of places you've recently been: how often, when, and the routes you take."**
- Visual: keep "Illustration". Do not style the list as iPhone Settings UI: viewing on iPhone isn't documented in these sources.

**Beat 3 (mechanism):** As written it is supported. It needs the off-by-default caveat (new claim c-timeline-off-by-default):
- New: **"On Android, Google Maps Timeline is off unless you turn it on. Once it's on, it saves your visits and routes to your phone, even when Google apps aren't open."**
- Optional on-screen: "Google Maps Timeline (Android; also Google Maps on iPhone)". The iOS help page documents the same feature.

**Beat 4 (problem):**
- "Apple says it can't read yours.": keep.
- Old: "Google keeps it on your phone." → New: **"Google says Timeline is saved on your phone, unless you turn on backup."** Source: "When you back up your Timeline data, Maps saves an encrypted copy of your data on Google's servers." (new claim c-timeline-backup)
- Old: "Either way, it's a diary of your days." This is an analogy with no ledger entry. Either add an analogy claim scoped to e4 plus the "Find your travels" per-day view (Google only), or use **"Either way, it's a record of where you've been."**
- Visual: add `"Illustration"` to onScreenText. The trails across the city are currently unlabelled.

**Beat 5 (takeaway):**
- Old: "Here's where to find it. Look first. Then keep it, or turn it off."
- New: **"Here's where it lives. In Google Maps, you can look through it first. Then keep it, turn it off, or turn it off and delete it."**
- Why: on iPhone the sources document only turning the setting off; viewing is documented for Mac only. On Google, "Turn off" and "Turn off and delete activity" are separate options, and "You'll keep your Timeline ... until you delete it."
- On-screen: change "Google Maps > profile picture > Your Timeline" to **"Google Maps > profile picture or initial > Your Timeline"**, and add **"To erase it too: Turn off and delete activity"**.
- If the lead wants "Look first" for iPhone, add an Apple source that documents viewing Significant Locations on iPhone, plus a claim for it.

**Beat 6 (twist):**
- Old: "Google can auto-delete it after three, eighteen or thirty-six months. At the longest, that's three years of places. It's on your phone right now. Go check."
- New: **"In Google Maps, you can set it to auto-delete after three, eighteen or thirty-six months. Or never: Google says it's kept until you delete it. If it's on, it's on your phone right now. Go check."**
- On-screen: "Auto-delete: 3, 18 or 36 months" → **"Google Maps Timeline auto-delete: 3, 18 or 36 months, or off"**. Keep "36 months = 3 years" and add **"Off = kept until you delete it"**.
- Visual: the city-wide web keeps "Illustration". Do not pair the "36 months" card with any implication that this is the default. The tension can stay: "kept until you delete it" is stronger than "three years" and is sourced.
- Rules: "Go check." is a setting check, not engagement bait. The promise (where to find it) is resolved in beat 5 before the twist. The ending does not point to another Reel (`endingReferencesRelated: false`).

## Caption

The paths are correct. Change "profile picture" to "profile picture or initial". Replace the Limits line with:

> Limits: Google says Timeline is off by default and only on if you opt in. Apple's pages cited here don't say whether Significant Locations & Routes is on by default, show how to view it only on a Mac, and don't say whether turning it off clears what's saved. On Google Maps, turning Timeline off isn't the same as deleting it ("Turn off and delete activity"); optional backups are encrypted copies on Google's servers; other Google settings such as Web & App Activity can also save location info. Menu names can differ by version and language. Apple and Google describe their own encryption; this video does not test it. Map visuals are illustrations; map data © OpenStreetMap contributors.

## Claims the script needs that the ledger lacks

I checked every passage below verbatim against the snapshots on disk. "A" means the Android page, "i" the iOS page.

| Proposed claim | Passage | Found in |
|---|---|---|
| c-timeline-off-by-default | "Timeline is off by default for your Google Account and can only be turned on if you opt in." | A, i |
| c-timeline-backup | "When you back up your Timeline data, Maps saves an encrypted copy of your data on Google's servers." | A, i |
| c-timeline-kept-until-deleted | "You'll keep your Timeline based on your auto-delete settings, or until you delete it." (plus "Under "Location settings," tap Auto-delete Timeline Don't auto-delete activity.") | A, i (second: A) |
| c-timeline-off-vs-delete (or replace e7) | "Tap More Location & privacy settings. Tap Timeline is on. Under "Timeline," from the dropdown menu, tap Turn off or Turn off and delete activity." | A, i |
| c-timeline-view (if "look through it") | "When Timeline is on, your Google Maps Timeline shows where and how you traveled, like walking, biking, driving, or on public transport." | A |
| c-other-google-location (caption) | "Other settings like Web & App Activity can also include info about your location from your device's general area and IP address." | A, i |
| analogy "diary of your days" (if kept) | e4 plus the "Find your travels" passage; scope to Google | A |

## Ledger fixes

- c-autodelete-options limitation: "the page does not say what happens when auto-delete is off" is wrong. Replace it with "When auto-delete is off, Google says Timeline is kept until you delete it; backup requires auto-delete off."
- c-iphone-keeps-places limitation: add "on devices signed in to iCloud with an Apple Account".
- c-android-timeline-path: replace e7 as above.
- Single-origin justifications are acceptable for these platform-owner docs. The two Google pages are one origin (`google-maps-help`), as the packet already records.

## Could not check

- Live pages: no network. The Google snapshot hashes don't match the packet (see above).
- Whether Significant Locations & Routes is on by default on iPhone, or viewable on iPhone. Neither is in these sources.
- Whether menu names match current iOS and Google Maps builds.
