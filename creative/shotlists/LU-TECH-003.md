# LU-TECH-003 shot list (camera reports)

The rules are in `../CINEMATIC.md`. Times are in the cut (preview v4); the narration sets them. "Approved" shots are left exactly as the owner signed them off.

| # | Beat | Time | Shot | Lens / aperture | Focus | Movement and why | Imperfection | Blend |
|---|---|---|---|---|---|---|---|---|
| 1 | Hook | 0–4.5 s | Close, slightly high, phone on the nightstand, clock behind | 35 mm, f/1.6 | Phone; clock falls off | Slow push-in: dread building as the screen wakes. **Approved, unchanged** | Smudged glass, worn wood, blind shadows | `location-map-phone.blend` |
| 2a | iPhone | 4.5–8.1 s | Wide, eye level from the bed, the room in moonlight | 26 mm, f/2.0 | **Rack:** duvet edge (near) → nightstand, frames 18–52, as the phone glows | Handheld creep toward the nightstand: someone in the room, not a crane | Rumpled linen, worn planks; operator sway | `scene2a-cine.blend` |
| 2b | iPhone | 8.1–12.9 s | Extreme close-up on the place list, low angle along the glass | 50 mm, f/2.0 | **Drifts down the list** to the newest places (frames 150–300) | Breathing handheld, near still: we are reading over a shoulder | Smudges plus **fingerprints** on the glass | `scene2-cine.blend` |
| 3 | Android | 12.9–22 s | Establishing night aerial, then tracking the route, then near top-down reveal | 28 → 19 mm (widens for the reveal) | Infinity (aerial) | Drone: slow descent while Timeline is off; follows the route's head with lag (spring), then rises for the reveal | Uneven lit windows, a tenth of buildings dark, roof clutter, haze; short shutter so lights stay sharp | `scene5-android-city.blend` |
| 4 | Stakes | 22–27.4 s | Macro push down into the glowing map | 50 mm, f/2.4 | Trail and pins | Handheld push-in: pressure building | Fingerprints, smudges, dust in the bokeh | `scene4-cine.blend` |
| 5 | Takeaway | 27.4–29 s | The nightstand still, dimmed under the menu paths | (plate from shot 1) | — | Slow scale 100 → 106%: a punch-in to hold attention while reading | — | plate |
| 6 | Twist | 29–39 s + black | Zoom out over the web of trails, then the dead screen reflecting the room | 35 mm, f/1.6 | Phone | Pull-back reveal, then dead still on "Or never". **Approved ("perfect"), unchanged** | Black glass reflection | `ending.blend` |

## Sound

| Layer | What | Where |
|---|---|---|
| In-scene | Room tone, appliance hum, a distant car passing | Bedroom shots (2a, 2b, 4) |
| In-scene | Wind at height, low city rumble | Aerial (3) |
| Audience | Approved hook sound, evolving score ducked under the voice, click and bells on the route's stops, risers, the ending's hits | Throughout |

## Finish

Picture-only cut → `scripts/finish.sh` (halation, vignette, moving grain) → text and sound laid on top (`--base`).
