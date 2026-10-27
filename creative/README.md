# Creative production (photoreal look)

The owner approved this look on 2026-10-26 as the base for every episode: a photoreal Blender scene rendered with Cycles, a real map on the phone screen, and sound synthesised for each shot. Shot 01 of the location-history episode is the reference (`storage/creative/shot01v3-with-sound.mp4`).

Everything generated lives in `storage/creative/` (git-ignored): the scene (`location-map-phone.blend`), downloaded assets, frames and clips. This folder holds only the scripts needed to rebuild them.

## Scripts

| Script | What it does | Run |
|---|---|---|
| `scripts/ph-download.mjs` | Downloads the chosen Poly Haven assets (CC0) at 2k into one folder per asset and checks every file against Poly Haven's md5. Edit the lists at the top to change assets. | `node creative/scripts/ph-download.mjs storage/creative/assets/polyhaven` |
| `scripts/osm-tiles.mjs` | Fetches a 3×6 block of OpenStreetMap tiles (zoom 16) around a point, slowly. The map must show "© OpenStreetMap contributors" wherever it appears. | `node creative/scripts/osm-tiles.mjs storage/creative/assets/osm/beirut-hamra 33.8960 35.4835` |
| `scripts/sound_shot01.py` | Synthesises shot 01's sound (screen click, accelerating heartbeat, drone, riser, ticks, impact), timed to the animation's frames. No paid audio. | `blender -b --factory-startup --python creative/scripts/sound_shot01.py -- storage/creative/shot01-sound.wav` |
| `scripts/encode_av.py` | Joins a PNG frame sequence and a WAV into an H.264/AAC MP4 with Blender (no Docker needed). | `blender -b --factory-startup --python creative/scripts/encode_av.py -- <frames dir> <sound.wav> <out.mp4>` |

## Rendering

- Render in a background Blender so the open one stays usable: `blender -b storage/creative/location-map-phone.blend -a -- --cycles-device CUDA` (use absolute paths).
- On the owner's RTX 3060, OptiX fails to load with the current NVIDIA driver; CUDA works. A driver update should bring OptiX back and speed renders up.
- Half size at 48 samples takes roughly 30–60 minutes per 5-second shot. Iterate on single stills first.
- The Blender MCP add-on needs Preferences → System → Network → Allow Online Access, then Add-ons → MCP → Start MCP Bridge Server (port 9876). Don't reload the scene while an agent is working in it.

## Rules that still apply

Visuals that illustrate a claim are claims (CLAUDE.md): an on-screen map, a number or a UI must match the evidence for the episode. Realistic AI-generated video (e.g. Higgsfield) would need the platform AI label; these Blender renders are 3D graphics, not AI-generated imagery.
