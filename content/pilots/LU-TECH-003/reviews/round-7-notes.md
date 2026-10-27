# LU-TECH-003 — independent AI verification, round 7

Reviewer: `claude-opus-5-5` (independent evidence agent, round 7). This is an AI check. It is **not** a qualified human review, and it is not the owner's approval.
Reviewed: 2026-10-27T12:01Z, against the `source-text/*.txt` snapshots (unchanged against HEAD).
Subject hash: `4c9ea38df72178852ff8f422fe343117b08efd119f826b3b634bc8a85ec68b50`. I computed it two ways: with the repo's `reviewSubjectSha256` + `claimLedgerSha256`, and with a separate canonical-JSON reimplementation. Both match the coordinator's value. The ledger hash is `880b5ca179c03d07a5c243a875a69ce627539a9c23241a8e500cb7f6952d76ca`, the same as round 6. As a cross-check, the same computation on the HEAD `script.json` gives the round-6 hash, `0b8ea10a…4069c76`.

## Bottom line

**All 12 claims: pass.** The new beat-2 visual is supported by the two claims it cites (c-timeline-off-by-default and c-android-timeline-saves), and I found nothing it implies that the ledger does not cover. Nothing has to change. There is one timing condition, and the edit already meets it.

## Diff against HEAD

- `script.json`: only `beats[2].visual` changed. The narration, `onScreenText`, `claimIds`, caption, `sourceList` and link are byte-identical.
- `packet.json` and `source-text/`: no change against HEAD (`git diff --quiet` is clean). All 17 evidence passages are still verbatim in the snapshots.

## What I looked at beyond the script text

These files are read-only to me, and I did not change any of them.
- `creative/scripts/build_android_city.py`: the route, stops, markers and camera.
- `creative/scripts/assemble_lu_tech_003.py`: where scene 5 sits in the edit, and the cards and credit.
- `storage/creative/narration-timing.json` and `android-city-events.json`.
- The test contact sheet `storage/creative/scene5-test/sheet.png`.

The final scene-5 render was still in progress (frames 1–16), so I judged composition from the test sheet.

## Claim-by-claim on beat 2

**c-timeline-off-by-default (lt3-e10): pass, with a timing condition.**
- The quiet city with no route plays under "Google Maps Timeline is off until you turn it on". That is a closer match to e10 than the old phone shot.
- Timing in the edit:
  - scene 5 starts at the beat-2 narration start (12.90 s);
  - "…turn it on." ends at 15.94 s;
  - the route turns on at frame 100 (16.23 s);
  - "Then" starts at 16.76 s.
- No toggle and no automatic switch-on is shown.
- **Condition:** the trail, its moving head light and the first stop marker must not appear before "…turn it on." ends. Today they don't. If the narration or the scene's start is re-timed, keep that order.

**c-android-timeline-saves (lt3-e4, lt3-e5): pass.**
- A route drawn along streets with a marker at each stop depicts "visits and routes" (e4). e13 ("where and how you traveled") supports the same reading.
- The drawing finishes as the sentence does: the last stop lights up at frame 232, the drawing ends at frame 238 (20.83 s), and "…even with Google apps closed." ends at 20.88 s.

## Things you asked me to check for

- **Sent anywhere / uploaded to Google:** not implied. There are no servers, no cloud, no satellite and no uplink beam. The narration in this beat says "to your phone", and backup is introduced only in beat 3 and the caption.
  - One caution: each new stop gets a rising "pillar" (a 70 m cylinder, fading upward) and an expanding ring. On the test sheet they read as short street-level glows, which is fine. If a re-grade or a closer camera made the pillar read as a beam into the sky, it would start to suggest transmission. Keep it short and at street level.
- **A real person's route:** no. The stops are hard-coded and made up (home > bakery > work > lunch > work > gym > home), snapped to the nearest street node rather than to a building. There are no labels or times, and the scene carries the 'Illustration' label.
- **Live tracking:** not implied. It is one finished past day, drawn quickly, and the camera rises to the whole route. Do not add a clock or "now", a "LIVE" tag, or a persistent "you are here" pulse on the last stop.
- **"The data is a map shown in the city":** no more than any map illustration. The route sits on the streets as a map line would, and the 'Illustration' label covers the stylisation.
- **Branding / UI:** no phone UI and no Google marks. The only Google reference is the existing, supported card text.

## Recommendations (not blocking)

1. **Recognisable real city.** The street data is centred on 33.896, 35.4835 (Beirut, Hamra), 650 m half-size. It has no names, but locals may recognise it.
   - The evidence is fine either way. This is an editorial call for the owner.
   - A night aerial of a recognisable Beirut neighbourhood with red marked locations can read as surveillance or targeting imagery, beyond the on-device point the beat makes. If the owner is comfortable with that reading, nothing needs to change. If not, a less recognisable or different street grid removes it.
2. **Credit in the reviewed on-screen text.** The edit renders '© OpenStreetMap contributors' from the start of beat 2 to the start of beat 4, and also in the hook and the ending. But no beat's `onScreenText` lists it; beat 2's visual only mentions "the map-data credit".
   - This was already true for the hook and the stakes beat in round 6. It is attribution, not a claim, and the caption carries the same credit.
   - At the next script version, add it to `onScreenText` for each beat where it is shown, so the reviewed text equals the rendered text. Doing that changes the subject hash, so do it with a new version and a new review, not now.
3. **Note for the lead (provenance, not evidence).** `osm-city.mjs` fetched the street data live from the public Overpass API (`fetchedAt` 2026-10-27T11:23:22Z). It was not paid and it is attributed, but please confirm that this fetch fits the studio's media-fetch policy.
4. **Beat times.** `script.json` gives beat 2 as 15.6–26.9 s, but the edit places it from narration timing (12.90–21.96 s). That was also true in round 6, and I judged timing on the edit. Consider syncing the script times at the next version.

## Rules check

- The promise is resolved before the twist; the takeaway is unchanged.
- No engagement bait.
- No caveat is withheld; the caption Limits are unchanged.
- The ending does not point to another Reel.
- Every map visual is labelled 'Illustration', and the OSM credit is on screen and in the caption.

## Could not check

- **Final render:** not complete. I judged from the test sheet and the build and edit scripts.
- **Live pages:** no network. The Google and Apple passages are verified against the snapshots on disk only.
