# TTS candidates for the narrator audition

Retrieval date for every entry: **2026-10-22**. Author: research agent (`claude-sonnet-5-5`).

## Read this first: evidence quality

- **Almost no official vendor page could be fetched.** The egress proxy refused `elevenlabs.io`, `platform.openai.com`, `openai.com`, `learn.microsoft.com`, `aws.amazon.com`, `cartesia.ai`, `wellsaidlabs.com`, `play.ht` and others. `cloud.google.com/text-to-speech/pricing` loaded but returned only a title (page truncated). I did not route around the block.
- Facts below come from **web-search result summaries on 2026-10-22**. A search summary that quotes an official page is cited with that official URL. Everything else is tagged **`unverified (third-party)`**.
- Items tagged `background knowledge, unverified` are things I believe from training data but did not confirm this session. Do not rely on them.
- **Prices change.** Treat every price as indicative. The owner or a session with web access must confirm on the vendor page before any spending decision. No account was created, no vendor contacted, no audio generated.
- The brief requires the owner to choose, and requires current license and API checks at audition time. This file is input to that, not the check.

## Candidate summary

| # | Provider / voice line | Still operating (2026-10-22)? | Evidence |
|---|---|---|---|
| 1 | ElevenLabs | Yes | Pricing pages and 2026 articles dated through 2026-10-10 (third-party) |
| 2 | OpenAI TTS (`gpt-4o-mini-tts`, `tts-1-hd`) | Yes | Official model pages on developers.openai.com returned by search |
| 3 | Google Cloud TTS (Chirp 3: HD) | Yes | Official pricing page returned by search |
| 4 | Microsoft Azure AI Speech (HD voices) | Yes | Official pricing pages returned by search (numbers not rendered) |
| 5 | Amazon Polly (Generative / Long-form) | Yes | Official pricing page returned by search |
| 6 | Cartesia (Sonic 3 / 3.5) | Yes | 2026 third-party guides (May and Aug 2026) |
| 7 | WellSaid Labs | Probably; API access unclear | Third-party only |
| - | PlayHT | **Likely defunct**: reported acquired by Meta (July 2025), standalone product and sites wound down; `unverified (third-party)`. Excluded. | Third-party |

## 1. ElevenLabs

- **Commercial use**: commercial use needs a paid plan; the free plan has no commercial rights. Lowest paid plan reported as Starter, $6/month. `unverified (third-party)` (bigvu.tv, smallest.ai, activepieces.com 2026 articles). Official terms: https://elevenlabs.io/terms (not fetched; `unverified`).
- **48 kHz**: `pcm_48000` appears in third-party lists of valid `output_format` values. Tier requirement for it not stated; `pcm_44100` reportedly needs **Pro** tier or above. `unverified (third-party)`. Also mp3 variants (`mp3_44100_*`). Format and tier must be checked at https://elevenlabs.io/docs.
- **Pronunciation control**: the API accepts `pronunciationDictionaryLocators` (pronunciation dictionaries). Phoneme (IPA/CMU) and alias rules and SSML `<phoneme>` support: `background knowledge, unverified`.
- **Stability / versioning**: model IDs are versioned (a third-party page mentions `eleven_v4`; `eleven_v3`, `eleven_multilingual_v2`, Flash models: `background knowledge, unverified`). Voice settings (stability, similarity, style) exist per request (`background knowledge, unverified`). Voice library voices can be removed or changed by their owner (`background knowledge, unverified`), so a stored voice ID is a drift risk; record the model ID and keep the approved reference clip.
- **Pricing** (retrieved 2026-10-22, all `unverified (third-party)`): Starter $6/mo, 30,000 credits; Creator $22/mo, 121,000 credits (first month 50% off in one source); Pro $99/mo, 600,000 characters; Scale $299/mo, 1,800,000 (one source says $330); Business up to $990. Sources disagree on credits, so confirm at https://elevenlabs.io/pricing. A table "checked against elevenlabs.io on 2026-10-10" is the most recent of these.
- **Consent / cloning policy**: official policy not fetched. Instant and professional voice cloning exist (`background knowledge, unverified`) and require rights or consent; the studio will **not clone**. Use only a stock/library voice whose license permits commercial use. Voice-library voices can carry their own terms; record the licence per voice.

## 2. OpenAI TTS

- **Commercial use**: a third-party aggregator says "commercial use with conditions"; vague. Official terms: https://openai.com/policies/terms-of-use and usage policies (not fetched; `unverified`). OpenAI has historically required telling users the voice is AI-generated (`background knowledge, unverified`); confirm.
- **48 kHz**: not found. Search only surfaced mp3, opus, aac, flac (third-party). `wav`/`pcm` and sample rate (commonly 24 kHz for pcm): `background knowledge, unverified`. Treat **native 48 kHz as not available** until shown; upsampling is not native detail.
- **Pronunciation control**: no SSML or dictionary known. `gpt-4o-mini-tts` takes natural-language style instructions (`background knowledge, unverified`). Pronunciation is controlled only by respelling the text.
- **Stability / versioning**: dated model snapshots exist (`background knowledge, unverified`); built-in named voices only, a fixed set. Behaviour can vary between generations (steerable model).
- **Pricing** (https://developers.openai.com/api/docs/models/tts-1-hd and .../gpt-4o-mini-tts, via search summary 2026-10-22): `tts-1-hd` $30.00 per 1M characters; `tts-1` $15.00 per 1M (a third-party blog notes the model page says "per MTok" while the pricing page says "per MChars"; unit `conflict`); `gpt-4o-mini-tts` $0.60 per 1M text input tokens plus $12.00 per 1M audio output tokens (billed per token, not per character).
- **Consent / cloning**: built-in voices only; custom voices for the public API are restricted (`background knowledge, unverified`). Nothing to clone, good for the "no unconsented cloning" rule.

## 3. Google Cloud Text-to-Speech (Chirp 3: HD)

- **Commercial use**: Cloud service under Google Cloud terms; generated audio is the customer's to use commercially (`background knowledge, unverified`). Check https://cloud.google.com/terms/service-terms and the Chirp 3 HD page.
- **48 kHz**: the API has `sampleRateHertz` and encodings LINEAR16, MP3, OGG_OPUS (search summary named MP3, Linear16, OGG Opus, no rates). Whether Chirp 3: HD outputs at 48 kHz natively or at 24 kHz: **`unverified`**. Needs a test call at audition.
- **Pronunciation control**: SSML is billed as characters (pricing page). Which SSML tags and whether custom pronunciation (`<phoneme>`, custom pronunciations field) work with Chirp 3: HD: `unverified`; background knowledge says Chirp 3 HD supports pronunciation customisation and pause control but not full SSML.
- **Stability / versioning**: voices are named (for example Charon, Puck, Orus: `background knowledge, unverified`); they are served as managed models and can change without notice, so re-audition on a schedule.
- **Pricing** (https://cloud.google.com/text-to-speech/pricing, search summary 2026-10-22): Chirp 3: HD **$30 per 1M characters**, free tier 0 to 1M characters per month; Instant custom voice **$60 per 1M characters**, no free usage. Billing counts all input characters including spaces and SSML tags (except `<mark>`).
- **Consent / cloning**: Instant custom voice exists; requires consent statements from the speaker (`background knowledge, unverified`). Studio will not use it.

## 4. Microsoft Azure AI Speech (Neural HD)

- **Commercial use**: Azure service; commercial use under the Microsoft product terms (`background knowledge, unverified`). Check https://learn.microsoft.com/azure/ai-services/speech-service/ and the Azure terms.
- **48 kHz**: formats like `riff-48khz-16bit-mono-pcm` and `audio-48khz-192kbitrate-mono-mp3` exist for neural voices (`background knowledge, unverified`; the search did not confirm). HD voices' native rate `unverified`.
- **Pronunciation control**: full SSML with `<phoneme>` and custom lexicons (`background knowledge, unverified`; the search did not confirm for HD voices).
- **Stability / versioning**: HD voices have versioned names (for example a "DragonHDLatestNeural" style suffix: `background knowledge, unverified`), with stable versions available; good for a pinned voice profile.
- **Pricing** (https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-api/): the official page returned placeholders "$-" in the search summary, so no official number was read. LiteLLM docs (third-party) list Neural $15 and Neural HD $30 per 1M characters. Free tier 0.5M characters per month for neural (Azure China page). All `unverified`; use the Azure pricing calculator.
- **Consent / cloning**: Custom Neural Voice is gated by an application and consent process (`background knowledge, unverified`). Not used.

## 5. Amazon Polly (Generative / Long-form)

- **Commercial use**: AWS service terms; you may cache and replay generated speech at no extra cost (pricing page). Other terms: https://aws.amazon.com/service-terms/ (not fetched).
- **48 kHz**: not confirmed. Polly's PCM/MP3 sample rates are commonly up to 24 kHz for neural and generative voices (`background knowledge, unverified`). Treat as probably **not 48 kHz native**.
- **Pronunciation control**: SSML including `<phoneme>` and lexicons (PLS) (`background knowledge, unverified`; not confirmed this session; support varies by engine, generative has narrower SSML).
- **Stability / versioning**: AWS manages engine versions; named voices like Matthew exist (`background knowledge, unverified`).
- **Pricing** (https://aws.amazon.com/polly/pricing/, search summary 2026-10-22): Standard $4.00, Neural $16.00 (a stray line shows $19.20; `conflict`), Long-Form $100.00, Generative $30 per 1M characters; Generative free tier 100K characters per month for 12 months.
- **Consent / cloning**: Brand Voice is a custom service (`background knowledge, unverified`); not used.

## 6. Cartesia (Sonic 3 / 3.5)

- **Commercial use**: reported: commercial license starts at the Pro plan; the free tier does not carry the commercial license (invideo.io, Aug 2026, `unverified (third-party)`). Official terms: https://cartesia.ai/terms (not fetched).
- **48 kHz**: not confirmed. Sonic output sample rates and formats (`pcm_s16le`, wav, mp3 at selectable rates) `background knowledge, unverified`; may include 44.1 kHz and 48 kHz. Needs a test.
- **Pronunciation control**: Sonic 3.5 reportedly improved heteronyms and alphanumeric read-out (third-party). Pronunciation dictionary / custom phoneme support: `unverified`.
- **Stability / versioning**: dated model IDs (`sonic-3`, `sonic-3.5`; GA of 3.5 reported May 2026, `unverified (third-party)`). Voice IDs are stable UUIDs (`background knowledge, unverified`).
- **Pricing** (retrieved 2026-10-22, `unverified (third-party)` and in `conflict`): CloudTalk (updated 2026-05-21) lists Pro $4/mo (yearly), Startup $39/mo, Scale $239/mo; invideo.io (Aug 2026) lists Startup $49, Scale $299, commercial license "from $5/month". Confirm at https://cartesia.ai/pricing.
- **Consent / cloning**: voice cloning exists; requires rights/consent. Studio will use a stock voice only.

## 7. WellSaid Labs

- **Commercial use**: reported: entry (Maker) tier excludes commercial use; Creative and Team tiers include commercial rights (`unverified (third-party)`). Official: https://wellsaid.io (not fetched).
- **48 kHz**: `unverified`. **Pronunciation**: respelling and a pronunciation library (`background knowledge, unverified`). **Versioning**: avatar/voice names; stable (`unverified`).
- **API**: one source says API is Enterprise-only; pricing is quote-based, with a third-party estimate of $5,000 to $10,000/month. Entry prices cited from $19/mo to about $199/mo per creator. All `unverified (third-party)` and `conflict`.
- **Consent / cloning**: custom brand voices are an enterprise service with consented talent (`unverified`).
- Likely poor fit: API access and cost. Included for completeness; do not audition unless the owner wants it.

## Recommendation: audition these three

1. **ElevenLabs** (a stock male voice, newest stable model). Reasons: the most natural, expressive English delivery in widely read 2026 comparisons (`unverified (third-party)` as a ranking claim); `pcm_48000` output reported; pronunciation dictionaries via API; a clear paid commercial tier. Risks: credit-based pricing varies by source; library-voice terms and removal risk; confirm the tier needed for 48 kHz.
2. **Cartesia Sonic 3.5**. Reasons: recent model (GA May 2026, third-party) reported to handle numbers/alphanumerics and heteronyms better, which this studio's script has plenty of; commercial license reported from the entry paid tier. Risks: pricing sources conflict; 48 kHz and pronunciation dictionary unconfirmed.
3. **Google Cloud Chirp 3: HD**. Reasons: official pricing read from Google's page ($30 per 1M characters, 1M free per month), enterprise-style terms, a managed API with SSML-style controls and LINEAR16 output at selectable rates; a good cost-controlled fallback. Risks: native rate and pronunciation tags for Chirp 3 HD unconfirmed.

Runner-up if one fails: **Azure Neural HD** (strong SSML/lexicon story, versioned voices; price unconfirmed). OpenAI TTS is not recommended for the final voice because 48 kHz and pronunciation control are unavailable; but it is cheap for scratch scripts. Polly and WellSaid are not recommended.

Audition protocol (for the lead, no spending without owner's cap and approval): same script, same pacing target (135 to 165 wpm, so about 25 seconds), render at the highest native rate each provider offers, record the model ID and voice ID in the voice profile, play blind in random order, and do not resample to look equal. Re-run the winner against the approved reference clip on a schedule to detect drift.

## Audition script (FIXTURE ONLY, NOT FOR PUBLICATION)

Neutral everyday-science topic. Contains an emotional turn, technical terms and numbers. This is a **test fixture**: it has no claim-ledger entry and must never enter an episode or a publishable artifact. The figures are standard textbook values written for pronunciation testing, not as a verified claim.

> Here is a small mystery. Ice floats. Nearly everything else shrinks when it freezes, but water doesn't. At 4 degrees Celsius it is densest, about 1,000 kilograms per cubic metre. Then, as hydrogen bonds lock it into a hexagonal lattice, it expands by roughly 9 percent.
>
> [pause] And that is the part that gets me. Because ice stays on top, a lake freezes from the surface down, and the fish below, in water near 4 degrees, are still alive in spring. Honestly? One small oddity, and so much life made it through.

Word count: about 80, which at 135 to 165 wpm is roughly 29 to 36 seconds. If the lead needs 20 to 30 seconds, drop the sentence "Honestly? One small oddity, and so much life made it through." and keep the emotional turn in "that is the part that gets me" (about 66 words, roughly 24 to 29 s).

Pronunciation probes in it: "Celsius", "1,000", "hexagonal lattice", "9 percent", "4 degrees", the pause, and the shift from curious to warm.

## Open questions for the owner

1. Which budget cap, if any, for audition generations (each provider's free tier may cover the test; the owner must authorise any spending or sign-up).
2. Accent preference (US, UK, other) to filter voices.
3. Confirm no cloning and no named-person voices; stock voices only.
4. A session with access to vendor sites must re-verify all `unverified` items, especially 48 kHz output, pronunciation controls and current prices, before the vendor choice is recorded in the voice profile.
