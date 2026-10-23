# ADR 0002 — Owner launch decisions

- **Status:** accepted by the owner, 2026-10-22
- **Decided by:** the owner (in session). Implementation notes by the lead.

| Topic | Owner decision | What it means for the build |
|---|---|---|
| Language | English, **US English** spelling and pronunciation | Scripts, captions and the voice profile use `en-US`. Units stay metric/Celsius where the audience expects them, spelled the US way ("meter"). |
| Audience | Primarily **Lebanon**, possibly wider | Evidence must say where guidance applies. US/EU-only rules (health guidance, product availability, finance) need a "where this applies" note or a Lebanon-relevant source. Data handling: aggregate metrics only; check Lebanese Law 81/2018 (electronic transactions and personal data) before any audience data beyond aggregates. |
| Narrator | One premium natural **male, US accent** | Audition stock US-male voices only. No cloning. Owner picks the voice and approves a reference clip. |
| Instagram | **Creator** account (owner to confirm); **no Meta developer app yet** | Use **Instagram API with Instagram Login** (graph.instagram.com, no Facebook Page). Owner follows the checklist in `docs/research/instagram-capability-record.md` §11 when ready. Mock adapter stays until then. |
| Voice provider | "Do what you recommend for best results" | Audition **ElevenLabs** (lead's first choice for natural delivery), **Google Chirp 3 HD** and **Cartesia Sonic**, stock US-male voices, same script. Sign-ups and API keys are the owner's; free tiers should cover auditions. Only the chosen provider becomes paid. |
| Spending | **$50–100** | Read as **monthly**: warning at **$50**, hard stop at **$100** (`spendingCapMicroUsd = 100_000_000`). Paid calls check the month's total *before* running and refuse past the cap. Owner sets the cap in the studio; the lead cannot set it. Change any time. |
| Deployment | **localhost** for now; **Docker + Docker Compose** (2026-10-23) | Studio, worker and Postgres run on the owner's machine as Compose services (`compose.yaml`), ports bound to 127.0.0.1. Consequence: Instagram fetches Reels from a **public URL**, which localhost cannot serve. Before the first live publish we need either Instagram's resumable upload (uploads bytes directly; to verify) or a short-lived signed URL from object storage. Decided at the live-publish milestone. |
| Cover (2026-10-23) | **Use the video's first frame** | The render extracts the delivery's frame 0 as the cover image; packages mark `coverSource: 'first_frame'`; live publishing sends `thumb_offset=0` and no `cover_url`, so the cover the owner approves is the one Instagram shows. No public cover hosting needed. The first frame is the hook beat's opening frame, so hooks should read well as a still. |
| Remotion | **Individual (only me)** | Eligible for Remotion's free licence as an individual, per the licence terms the lead knows (verify on remotion.dev/license before installing). Adopt Remotion for compositions at the rendering milestone. |

## Open

- Owner to confirm the account is Creator (Instagram → Settings → Account type and tools).
- Re-verify provider pricing, 48 kHz output and terms from a network that can reach vendor sites.
