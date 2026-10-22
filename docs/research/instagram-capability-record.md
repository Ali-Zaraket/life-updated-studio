# Instagram capability record

Retrieval date for every entry below: **2026-10-22**. Author: research agent (`claude-sonnet-5-5`).

## Read this first: evidence quality

- **No official Meta page could be fetched.** In this session `developers.facebook.com`, `developers.secure.facebook.com`, `www.postman.com`, `about.fb.com` and `help.instagram.com` were all refused by the egress proxy (HTTP 403 on CONNECT, or DNS failure). I did not route around that.
- Every fact here comes from **web-search result summaries on 2026-10-22**. Those summaries paraphrase or quote official Meta pages. Where a summary quotes Meta, the source URL is the official one the search returned.
- Where only third-party blogs, wrappers or GitHub issues supported a claim, it is marked **`unverified (third-party)`**.
- Where sources conflicted, both values are given and marked **`conflict`**.
- **Nothing here may be treated as final.** Before any live call, the lead must have the owner (or a session with Meta docs access) confirm every `unverified` and `conflict` item against the official page. Section 6 of the brief requires this.
- No live API calls were made. No account was contacted.

Official URLs returned by search (all retrieved 2026-10-22, content seen only as search summaries):

| Short name | URL |
|---|---|
| Content publishing | https://developers.facebook.com/docs/instagram-platform/content-publishing |
| Content publishing (IG Login) | https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing |
| Resumable uploads | https://developers.facebook.com/documentation/instagram-platform/content-publishing/resumable-uploads |
| IG User Media reference | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media |
| Business Login for Instagram | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login |
| Create a Meta app with Instagram | https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/create-a-meta-app-with-instagram |
| Refresh Access Token | https://developers.facebook.com/documentation/instagram-platform/reference/refresh_access_token |
| Instagram Media Insights | https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights |
| Instagram Account Insights | https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights |
| Insights overview | https://developers.facebook.com/docs/instagram-platform/insights |
| Platform overview | https://developers.secure.facebook.com/documentation/instagram-platform/overview |
| Graph API versions | https://developers.facebook.com/docs/graph-api/changelog/versions/ |
| Graph API v26.0 changelog | https://developers.facebook.com/docs/graph-api/changelog/version26.0/ |
| Graph API v22.0 changelog | https://developers.facebook.com/docs/graph-api/changelog/version22.0/ |

## 1. Current Graph API version

- **v26.0**, released 2026-07-29, listed with expiry "TBD". Source: Graph API versions page, https://developers.facebook.com/docs/graph-api/changelog/versions/ (search summary, 2026-10-22).
- v25.0 released 2026-02-18, available until 2028-07-29. Source: same page; also https://developers.facebook.com/blog/post/2026/02/18/introducing-graph-api-v25-and-marketing-api-v25.
- Meta's Reels example in the IG User Media reference used `graph.facebook.com/v26.0/.../media`; the resumable-upload example URI used `v25.0`. So docs examples span versions.
- `unverified (third-party)`: a Fixmation blog says a Meta change on 2026-10-27 alters behaviour across all Graph API versions (legacy protocol features such as ETag/304). This is five days from the retrieval date. The lead should read the v26.0 changelog before the first live call.
- Recommendation: pin the version in config (`META_GRAPH_VERSION=v26.0`), never hard-code it, and record the version with every stored response.

## 2. The two login paths (do not mix)

| | Instagram API with **Instagram Login** | Instagram API with **Facebook Login** |
|---|---|---|
| Login product | Business Login for Instagram | Facebook Login for Business |
| Token type | Instagram User access token | Facebook User or Page access token |
| Host | `graph.instagram.com` (search summary of Meta content-publishing docs: "All endpoints can be accessed via the graph.instagram.com host") | `graph.facebook.com` (Meta's Reels example used `graph.facebook.com/v26.0/...`) |
| Facebook Page required | No | Yes, the Instagram account must be linked to a Page (per Platform overview summary; third-party guide wording) |
| Account types | Instagram professional accounts (Business or Creator). Exact per-path wording `unverified`. | Instagram professional accounts linked to a Page. Exact wording `unverified`. |
| Publishing | Supported (`instagram_business_content_publish`) | Supported (`instagram_content_publish`) |
| Features only on this path | None needed for this studio | Hashtag search, product tagging, partnership ads (`unverified (third-party)` comparison table) |

Sources: Business Login for Instagram; Platform overview; Content publishing (all above). A Zernio table claiming Instagram Login is "read-only" conflicts with Meta's overview and several 2026 guides; it appears outdated. Treat as `conflict`, resolved in favour of Meta's overview, but **confirm on the live page**.

**Recommendation (single-owner Creator/Business account): Instagram API with Instagram Login.** Reasons:
1. No Facebook Page needed, so one fewer asset to set up and secure.
2. The studio needs only publishing and insights, which this path lists.
3. The owner is the only user, so the app can stay in development mode with the owner holding a role.

Do not store, send or accept a Facebook-path token on this path, and vice versa. The adapter should carry a `login_path: "instagram"` field and refuse any host or scope from the other path. If the owner's account turns out not to be eligible for Instagram Login, switch the whole adapter, not part of it.

## 3. Permissions, access level and review

Instagram Login path (names after the January 2025 rename; sources: Content publishing, Business Login, plus third-party summaries):
- `instagram_business_basic` (needed for profile, media listing and token refresh).
- `instagram_business_content_publish` (publishing).
- Insights: Meta's media-insights page lists no separate scope in the summaries I saw. `unverified`: whether `instagram_business_manage_insights` or just `instagram_business_basic` is required on this path. Confirm on the Media Insights page.

Facebook Login path (for reference only, not recommended): `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, plus `pages_show_list` / `pages_read_engagement`. `unverified (third-party)` for the last two.

Old names `instagram_content_publish` / `business_content_publish` on the Instagram Login path are deprecated (`unverified (third-party)` on exact dates).

Access levels (summary of Meta statements as relayed by 2026 guides; `unverified` until read on Meta's page):
- **Standard Access** works for accounts owned by people with a role on the app. A single owner who is an admin/developer of their own app can use their own account without App Review.
- **Advanced Access** (App Review plus Business Verification) is needed to serve accounts that have no role on the app. Not needed for a single-owner studio.
- Development-mode tester flow: add the Instagram account as an **Instagram Tester** under App Roles, accept the invite in Instagram (Apps and websites, Tester invites), then use "Generate token" in the dashboard. The account must be public per the summary (`unverified` whether this remains true).
- The brief requires recording "access level" and "app review status" in this record at implementation. Status today: **not applicable until the owner creates the app** (see checklist, section 11).

## 4. Token lifecycle (Instagram Login)

Source: Refresh Access Token reference (search summary 2026-10-22).
- A **short-lived** Instagram User token is issued by the OAuth code exchange. Its lifetime is `unverified` (commonly stated as 1 hour; not confirmed this session).
- A **long-lived** token is obtained by exchanging the short-lived token (`ig_exchange_token`, server-side, needs app secret). Lifetime **60 days** (refresh response `expires_in` example 5183944 s, about 60 days).
- **Refresh**: `GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<long-lived>`. Eligibility per the reference: token is at least **24 hours old**, not yet expired, and the app user has granted `instagram_business_basic`. Each refresh gives 60 days from the refresh date.
- A token not refreshed within 60 days **expires and cannot be refreshed**; the owner must re-authorize.
- Studio rule (from brief): store the token encrypted, alert at 14 and 7 days before expiry, refresh on a schedule (for example weekly), redact in logs.
- Dashboard-generated tokens for a tester account: whether they arrive long-lived is `unverified`.
- Facebook-path token lifecycle (Page tokens that never expire when derived from long-lived user tokens) is `unverified` and out of scope.

## 5. Reels publishing flow

Sources: Content publishing; IG User Media reference; Resumable uploads (search summaries, 2026-10-22).

1. **Create container**: `POST /{ig-user-id}/media` with:
   - `media_type=REELS`
   - `video_url=<public URL>` (omit when using resumable upload)
   - `caption`
   - `cover_url=<image URL>` or `thumb_offset=<ms>` (thumb_offset described as a frame location in milliseconds, units from third-party guide: `unverified`)
   - `share_to_feed=true|false` (true shows it in both Feed and Reels tabs; Reel must meet duration, length and encoding requirements)
   - Other fields (`collaborators`, `audio_name`, `location_id`, `user_tags`, `trial_params`): `unverified`, not needed for MVP.
2. **Poll status**: `GET /{container-id}?fields=status_code`. Values per Meta docs (summary): `EXPIRED`, `ERROR`, `FINISHED`, `IN_PROGRESS`, `PUBLISHED`. Meta suggests polling about once a minute for up to five minutes (summary; `unverified` as an exact quote). A container not published within **24 hours** becomes `EXPIRED`. `ERROR` is terminal; a new container is needed. A `status` field with error detail exists (`unverified` exact name).
3. **Publish**: `POST /{ig-user-id}/media_publish?creation_id=<container-id>`. Returns the media ID.
4. **Permalink**: `GET /{media-id}?fields=permalink` (field name standard in the Graph API; `unverified` in this session's summaries). After publishing, `media_type` reads back as `VIDEO`, not `REELS` (Meta docs summary).
5. If `media_publish` returns no media ID (timeout), query the container status first; do not blindly retry (brief section 6 and CLAUDE.md reconciliation rule). Reconciliation by listing recent media and matching caption/time is the studio's own design, not documented Meta behaviour.
6. **Resumable upload** exists: create the container with `upload_type=resumable` and no `video_url`; the response returns `ig-container-id` and a `uri` on `rupload.facebook.com/ig-api-upload/<version>/<container-id>`; the file is then sent to that URI. It is intended for local files and recovery after network failure. Header and offset details `unverified`; read the Resumable uploads page before implementing. The studio can use either a signed, short-lived `video_url` or resumable upload; resumable avoids hosting the file publicly (relevant to the SSRF/media rules).
7. `video_url` must be reachable by Meta's servers. Exact requirement (public, no auth redirect, content-type) `unverified` this session.

## 6. Publishing rate limits and general API limits

- **Posts per 24 hours**: `conflict`. A search summary says Meta states **100 API-published posts per rolling 24 hours** for an account; the same summary notes an older/other Meta guide cited **50**. Check the live page. Plan for far fewer; the studio publishes a few Reels per week.
- **Quota endpoint**: `GET /{ig-user-id}/content_publishing_limit` (with `fields=quota_usage,config`; field names `unverified` this session). Use it before publishing and when a rate-limit error occurs. Error code 9 / subcode 2207042 was reported by a third party as the publishing-limit error (`unverified (third-party)`).
- **General API limits**: `conflict`. Business Use Case rate limiting is described as `4800 x number of impressions` calls per rolling 24 hours per app-user pair (apis.io profile and a forum post quoting Meta). Phyllo and Elfsight state a flat 200 calls per user per hour; this looks outdated or simplified. Over-limit responses are HTTP 429 / error 80002 with an `X-Business-Use-Case-Usage` header (`unverified (third-party)`). Studio rule: read that header, back off, never loop.

## 7. Native scheduling of Reels

- **Not confirmed.** The search summaries found nothing in Meta's docs describing a `scheduled_publish_time` or equivalent for Instagram Reels via this API. Status: `unverified`. Do not assume it exists.
- Studio decision stands (brief section 6): scheduling lives in the studio's durable queue; the worker re-checks approval, evidence freshness, permissions and quota at execution time.

## 8. Reels video specs for API upload

Source: Meta Reels specifications, as quoted in a search summary of the IG User Media / Content publishing docs (2026-10-22). Quoted text: "Container: MOV or MP4 (MPEG-4 Part 14)... Audio codec: AAC, 48khz sample rate maximum... Video codec: HEVC or H264... Frame rate: 23-60 FPS... aspect ratio between 0.01:1 and 10:1 but we recommend 9:16... Video bitrate: VBR, 25Mbps maximum... Duration: 15 mins maximum, 3 seconds minimum... File size: 300MB maximum."

| Spec | Value | Status |
|---|---|---|
| Container | MOV or MP4 (MPEG-4 Part 14) | from Meta summary |
| Video codec | HEVC or H.264 | from Meta summary |
| Audio codec | AAC, 48 kHz max | from Meta summary |
| Frame rate | 23 to 60 fps | from Meta summary |
| Aspect ratio | 0.01:1 to 10:1 accepted; 9:16 recommended | from Meta summary |
| Duration | 3 s min, 15 min max | from Meta summary |
| File size | 300 MB max | from Meta summary |
| Video bitrate | VBR, 25 Mbps max | from Meta summary |
| Max resolution | not stated in summary | `unverified`; studio default 1080 x 1920 is the safe choice |
| Audio channels, audio bitrate, chroma, GOP, profile | not stated | `unverified` |
| Cover image | JPEG, 8 MB limit (third-party) | `unverified (third-party)` |

`conflict`: older third-party guides list 100 MB and 5 Mbps; one cites Meta's own page for them, so those may be an older version. A 90-second cap and "5 to 90 s for Reels tab eligibility" appear in third-party guides and conflict with the 15-minute figure. The brief says validate against the chosen API version at export; keep the validator configurable, default to the stricter old values (under 100 MB, under 90 s, 1080 x 1920, H.264, AAC 48 kHz, 30 fps) until the owner or a session with docs access confirms.

Studio delivery spec in the brief (1080 x 1920, MP4 H.264, 30 fps, AAC 48 kHz) fits inside all the reported limits.

## 9. Insights

Sources: Instagram Media Insights, Instagram Account Insights, Insights overview, Graph API v22.0 changelog (search summaries 2026-10-22).

**Deprecations** (v22.0 changelog summary): `impressions`, `plays`, `clips_replays_count` and `ig_reels_aggregated_all_plays_count` were deprecated for all API versions on **2025-04-21**. `impressions` still returns data only for media created before **2024-07-02** and errors for later media. Replacement: **`views`**, available for Feed, Story and Reels media and for user (account) insights.

**Media metrics for Reels** (names from Meta summaries; definitions only where Meta text was quoted):
| Metric | Notes | Status |
|---|---|---|
| `views` | replaces plays/impressions | from Meta |
| `reach` | "Number of unique Instagram users that have seen the reel at least once" | from Meta |
| `ig_reels_avg_watch_time` | "The average amount of time spent playing the reel"; unit is milliseconds per a third-party guide | name from Meta; unit `unverified (third-party)` |
| `ig_reels_video_view_total_time` | listed as in development | `unverified` |
| `reels_skip_rate` | marked estimated / in development | `unverified` |
| `likes`, `comments`, `shares`, `saved` | exact API field names for saves/shares not confirmed this session | `unverified` |
| `total_interactions` | no Meta doc found; may be a connector name | `unverified` |

Per-second retention curves, completion rate, profile actions and follower attribution to a single Reel: **not found in Meta docs; treat as unavailable** (brief already says optional).

**Account metrics**: `GET /{ig-user-id}/insights` with `metric`, `period`, and for new metrics `metric_type=total_value`. `views` has breakdowns for `follower_type` and `media_product_type`. `reach` and `follower_count` are candidates; per-metric period support (for example `follower_count` day only) is from a connector doc, `unverified`.

**Windows and caveats** (Meta summaries):
- Metric data may be delayed up to **48 hours**.
- The API returns an **empty data set instead of 0** when data is unavailable. This matches the studio rule: store `null` with a reason.
- Some metrics are unavailable on accounts with **fewer than 100 followers**.
- User-metric data is stored for up to **90 days**.
- Media older than a given age, or posted before conversion to a professional account: **not found; `unverified`**.
- Brief collection windows (about 1 h, 24 h, 72 h, 7 d): the 1 h snapshot may well be empty or partial given the 48 h delay note; record it as `null` with reason, not zero.

## 10. AI-generated content label or disclosure

- **Official docs**: no AI-label field was found in Meta's IG User Media reference snapshot (the cached copy returned by search was about 577 days old, so it may predate any new field). Status: `unverified`.
- **Third-party reports**: a GitHub PR (LeighAtkins/ReelWalk #118) and two wrapper APIs (Ayrshare `isAIGenerated`; Outstand) describe a container parameter **`is_ai_generated=true`** that applies the "AI info" label, with a Meta changelog date of **2026-06-22** given only in the PR text. This is `unverified (third-party)`. It is not accepted evidence; the lead must have it confirmed on Meta's current IG User Media reference or changelog.
- Context: Meta's AI labeling policy explanation is https://about.fb.com/news/2024/04/metas-approach-to-labeling-ai-generated-content-and-manipulated-media/ (cited in the brief; not fetched this session).
- **Compliant rule for the studio** (brief section 11): if the field is not confirmed in official docs, **hold API publication of any Reel that needs the label** and give the owner a manual path:
  1. The studio exports the approved media, cover and caption.
  2. The owner uploads in the Instagram app and turns on Instagram's own AI-content label control in the post's advanced settings before sharing. The exact menu wording and location is `unverified`; the owner should follow the in-app prompt.
  3. The owner pastes the permalink back; the studio records it as `manual publish`, which does not count as completed API publishing (brief section 6).
- A caption sentence does not replace the platform label.
- If the field is confirmed later, the approval must bind the disclosure setting (CLAUDE.md), and the worker should read back the label state after publishing if the API exposes it (`unverified`).

## 11. Owner access checklist (Instagram Login path)

Every step is an owner action; the studio never performs account-setting changes. Menu names may have moved: follow Meta's current UI and tell the lead if a step differs.

1. Decide the Instagram account that will publish. Confirm you can log in to it and that it is **public** (tester flow requires this per the summary).
2. In the Instagram app, switch the account to **Professional**: Settings, then Account type and tools, then Switch to professional account. Choose **Creator** or **Business**. Record which.
3. Create (or use) a **Meta developer account** at developers.facebook.com using your personal Facebook login, and accept the developer terms. A Facebook account is needed for the developer portal even though the Instagram-Login path needs no Page.
4. In the App Dashboard, **Create app**. Choose the use case for managing Instagram messaging and content (wording `unverified`; the app must be of type **Business** per one summary). Name it, for example, "LIFE UPDATED Studio".
5. In the app, open **Add product** and add **Instagram**; on its page choose **API setup with Instagram login**.
6. Under **App roles**, confirm you are Admin. Under **Roles**, add your Instagram account as an **Instagram Tester** (search by username), then in the Instagram app accept the invite under Settings, Apps and websites, Tester invites.
7. In the Instagram product page, in **Set up Instagram business login**, add the OAuth redirect URL that the lead supplies (the studio's `/auth/instagram/callback` on its own HTTPS host). Do not use a URL you do not control.
8. Under the same page, request/enable the permissions `instagram_business_basic` and `instagram_business_content_publish`, plus the insights permission once its name is confirmed.
9. Use **Generate access tokens**: Add account, then Generate token. **Do not paste the token into chat or commit it.** Put it only in the local environment file the lead names. Copy the Instagram user ID shown there the same way.
10. Copy the **app ID** and **app secret** into local config only. Never share the secret.
11. Leave the app in **Development mode**. Do not submit for App Review or Business Verification (not needed for a single owner's own account, per the summaries; `unverified` until the lead confirms).
12. Tell the lead the account type, Instagram user ID (not the token), the app ID, and the Graph API version shown in the dashboard.
13. Decide your spending/risk rule for the first live test: one private test post is **not** possible via API (published Reels are public). Choose to run the first live smoke test as a real approved Reel or skip it; the studio will not publish without your explicit approval.
14. Before the first live call, confirm on the live Meta pages: the AI label field, post limit (50 vs 100), scheduling, and insights permission name.

If you later need the Facebook path instead: link the Instagram account to a Facebook Page you control (Instagram Settings, Account center or Page settings, Linked accounts), add the Facebook Login for Business product, and request `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`. Do not combine this with the steps above.

## 12. Open items for the lead and owner

1. Re-verify everything marked `unverified` or `conflict` against official pages from a session that can reach `developers.facebook.com` (egress proxy denied it here).
2. Confirm `is_ai_generated` (or any official equivalent) and its changelog date.
3. Confirm 50 vs 100 posts per 24 h, video spec table (max resolution, cover specs), and whether native scheduling exists.
4. Confirm insights scope name and metric field names (`saved`, `shares`).
5. Read the Graph API v26.0 changelog for the 2026-10-27 change before first live call.
