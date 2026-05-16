# PnL Share — Bot Integration Guide

How the **big-win bot** can post a replay link to X and have the unfurled card render the player's PnL image automatically — even when the player never opened or shared their own PnL card.

---

## TL;DR

When X (or any OG-aware crawler) fetches a URL like:

```
https://www.ape.church/games/<game-slug>?id=<replayId>
```

the page's `generateMetadata` does a HEAD request to Supabase Storage at:

```
{SUPABASE_URL}/storage/v1/object/public/pnl-share/<game-slug>/<replayId>.png
```

If that PNG exists, it is emitted as the Open Graph + Twitter `summary_large_image`. If it doesn't, the page falls back to the site-wide default OG image.

**The bot's only job is: render the PNG and PUT it at the right path *before* the X post goes out.** No new code is required on the consuming side — the OG metadata layer already handles whatever is at the storage URL.

---

## 1. Architecture (read-only context)

```
┌─────────────────────────┐     POST imageBase64    ┌──────────────────────────┐
│  Big-win bot (you)      │ ──────────────────────▶ │ /api/pnl-share/upload    │
│  (render + upload)      │                         │ (this app)               │
└─────────────────────────┘                         └────────────┬─────────────┘
                                                                 │ Supabase SDK
                                                                 ▼
                                                ┌─────────────────────────────┐
                                                │ Supabase Storage            │
                                                │   bucket: `pnl-share`       │
                                                │   path:   `<slug>/<id>.png` │
                                                │   ACL:    public read       │
                                                └─────────────────────────────┘
                                                                 ▲ HEAD on unfurl
┌─────────────────────────┐                                      │
│  Bot tweets:            │                                      │
│  https://.../games/<s>  │ ───── X crawler fetches page ───────┐│
│       ?id=<id>          │                                     ▼│
└─────────────────────────┘                         ┌──────────────────────────┐
                                                    │ generateMetadata in      │
                                                    │ app/games/<slug>/page.ts │
                                                    │ → mergeGameReplayMetadata│
                                                    │ → emits og:image + tw:   │
                                                    │   summary_large_image    │
                                                    └──────────────────────────┘
```

Reference files in this repo:

- `components/PNLCard.tsx` — the React component the manual flow renders, and the layout the PNG must match.
- `app/api/pnl-share/upload/route.ts` — the upload endpoint the bot will call.
- `lib/pnl-share.ts` — path / URL helpers (the bot must compute identical paths).
- `lib/game-replay-metadata.ts` — the OG meta builder that picks up your uploaded PNG.
- `lib/constants/games.ts` — the `gameAddress → url` (slug) map; treat as the source of truth.

---

## 2. Inputs the bot needs per big win

To produce the same card the manual flow produces, the bot must gather:

| Field | Type | Example | Source |
| --- | --- | --- | --- |
| `gameAddress` | `0x…` | `0xa67d…cBE2` (roulette) | win event on-chain |
| `replayId` | decimal string | `"183245"` | on-chain bet id; **must be numeric, no leading zeros stripping**. Same value used as `?id=` in the replay URL. |
| `gameSlug` | string | `"roulette"` | resolve from `gameAddress` via `lib/constants/games.ts` → `game.url` → strip `/games/`. |
| `gameTitle` | string | `"Roulette"` | the human game name displayed on the card |
| `totalPayout` | string with unit | `"+13,900 APE"` | what the player received |
| `pnlPercentage` | string | `"+139%"` | (profit / wagered) × 100, prefixed `+` |
| `wagered` | string with unit | `"10,000 APE"` | total stake |
| `profit` | string with unit | `"+3,900 APE"` | payout − wagered, prefixed `+` |
| `playerAddress` | `0x…` | player's wallet | from the win event |
| `playerProfile` | object \| null | see below | call `GET /api/profile?address=<playerAddress>` |

The card itself is rendered the same way for every user; if `playerProfile.referral_code` is present, the right-side QR encodes `https://ape.church/?ref=<code>` and the player's `x_handle` / `x_pfp` are shown. If not, a centered QR to `https://ape.church` is shown instead. **All this is purely visual — it does not affect the storage path or the X URL.**

### Player profile shape

`GET /api/profile?address=<lowercase address>` returns:

```json
{
  "user_address": "0x…",
  "username": "0x…",       // fallback to address if unset
  "x_handle": "alice" | null,
  "x_pfp":    "https://…" | null,
  "referral_code": "ALICE7" | null,
  "x_verified": true,
  "x_score": 123 | null,
  "referred_by_address": "0x…" | null
}
```

A `null` `referral_code` is normal — many players never registered one. Render the QR fallback (centered, `https://ape.church`) in that case.

> **Important:** the bot posts the X link with **no `?ref=`** parameter. The manual user-share flow adds the player's own referral code; the bot's posts do not.

---

## 3. Storage contract (must match exactly)

If any of these diverge, the OG metadata layer will not find your image and the post will unfurl to the default image.

### Bucket

`pnl-share` — public-read. (Configurable via `SUPABASE_PNL_SHARE_BUCKET` / `NEXT_PUBLIC_SUPABASE_PNL_SHARE_BUCKET`; default is `pnl-share`.)

### Object path

```
<sanitized-game-slug>/<numeric-replay-id>.png
```

**Slug sanitization** (`lib/pnl-share.ts:sanitizePnlGameSlug`) — bot must apply the same rules:

1. trim
2. lowercase
3. replace any run of characters that are not `[a-z0-9-]` with a single `-`
4. strip leading and trailing `-`
5. collapse runs of `-` to a single `-`

**Replay id**: must match `/^\d+$/`. Anything else is rejected with HTTP 400.

### Public URL

```
{NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/pnl-share/<slug>/<id>.png
```

This is what X will fetch when unfurling.

### Image format

- PNG only (file signature `89 50 4E 47 0D 0A 1A 0A` is checked server-side).
- Min 32 bytes, max **2,500,000 bytes** (2.5 MB).
- The reference render the existing client produces is **1320 × 742** (the visible export node is 660 × 371 at `pixelRatio: 2`). Bots should target the same aspect ratio (≈ 16:9, more precisely 1.778:1). X requires ≥ 600 × 314 for `summary_large_image`; 1320 × 742 is comfortably above that.
- Background color of `#000000` is what the manual flow uses; not required but recommended for visual parity if your renderer can't fully reproduce the meme background layer.

---

## 4. Upload API

Both endpoints live at `app/api/pnl-share/upload/route.ts` and are unauthenticated. They are **idempotent**: the POST is a no-op when the object already exists.

### `GET /api/pnl-share/upload?gameId=<id>&gameSlug=<slug>`

Cheap existence probe. Use it to short-circuit before generating a PNG.

- `200 OK`:
  ```json
  { "exists": true,  "publicUrl": "…", "gameId": "183245", "gameSlug": "roulette" }
  ```
  or
  ```json
  { "exists": false, "publicUrl": "…", "gameId": "183245", "gameSlug": "roulette" }
  ```
- `400 Bad Request` — `gameId` not numeric or `gameSlug` invalid.
- `503 Service Unavailable` — Supabase not configured on the server.

### `POST /api/pnl-share/upload`

Uploads a PNG. Body:

```json
{
  "gameId":      "183245",
  "gameSlug":    "roulette",
  "imageBase64": "data:image/png;base64,iVBORw0KGgoAAA…"
}
```

`imageBase64` may include the `data:image/png;base64,` prefix or not. The server strips it.

Responses:

- `200 OK`, freshly uploaded:
  ```json
  { "publicUrl": "…", "gameId": "183245", "gameSlug": "roulette", "skippedUpload": false }
  ```
- `200 OK`, already present (idempotent path — both pre-check and race-after-upload):
  ```json
  { "publicUrl": "…", "gameId": "183245", "gameSlug": "roulette", "skippedUpload": true }
  ```
- `400 Bad Request` — invalid `gameId`, invalid `gameSlug`, missing image, invalid base64, image size out of range, or not a PNG.
- `500 Internal Server Error` — Supabase upload failed for non-race reasons.
- `503 Service Unavailable` — Supabase not configured.

### Recommended bot flow

```
on big_win(event):
    slug    = sanitize(game_url(event.gameAddress).replace("/games/", ""))
    id      = str(event.replayId)
    if not slug or not id.isnumeric(): drop_and_log()

    # 1. Cheap existence probe
    probe = GET /api/pnl-share/upload?gameId={id}&gameSlug={slug}
    if probe.exists:
        public_url = probe.publicUrl
    else:
        # 2. Gather card inputs
        profile  = GET /api/profile?address={event.playerAddress}
        png_b64  = render_pnl_card(event, profile)        # see §5
        # 3. Upload (idempotent; safe to retry)
        res = POST /api/pnl-share/upload {gameId, gameSlug, imageBase64: png_b64}
        public_url = res.publicUrl

    # 4. Verify the public URL really resolves before tweeting
    if HEAD public_url != 200: retry_with_backoff()

    # 5. Tweet — no ?ref= here
    tweet(
      text = f"Check out this big {gameTitle} win on Ape Church! @apechurch",
      url  = f"https://www.ape.church/games/{slug}?id={id}",
    )
```

The verification step in #4 protects against rare races between the upload completing and Supabase's public CDN serving the object.

---

## 5. Rendering the PNG

The bot must produce the card image itself; the server endpoint does not render. There are three reasonable approaches — pick whichever matches the bot's stack.

### Option A — Headless browser against this app *(highest fidelity)*

Run Playwright or Puppeteer, navigate to a hidden render route in this app that mounts `<PNLCard hideOpenButton />` with the win props on a fixed-size export viewport, wait for fonts + images, then `page.screenshot({ type: "png", clip: {…} })`. Pros: pixel-identical to user-shared cards; uses the same React component and Supabase fonts. Cons: heavier infra (Chromium); requires a small new render route in this app — talk to the web team if you want this.

### Option B — Satori (`@vercel/satori`) *(lightweight, JS-only)*

Build a JSX replica of `PNLCard.renderCardInner("export")` (the layout in `components/PNLCard.tsx:649`), feed it to Satori → SVG, then rasterize SVG → PNG with `@resvg/resvg-js` or `sharp`. Pros: no headless browser, fast, ~MB-scale memory. Cons: must hand-port the export layout and fonts; QR code must be pre-rasterized or rendered separately. Reference dimensions: 660 × 371 at scale 2.

### Option C — Native canvas (`node-canvas`, Skia, ImageMagick, etc.)

Composite the meme background + dark right-side panel + text + QR using your renderer of choice. Lowest dependency cost; most layout work.

Whichever option you pick, the only contract that matters is the **PNG bytes + storage path**. The image content can drift slightly from the user-shared version without breaking unfurls — what cannot drift is the path, signature, and size constraints in §3.

### Background images (fetched from the live CDN)

The manual flow picks one of ten meme backgrounds at random. The bot fetches the same ten PNGs directly from the public site — they are static assets served by Next.js, cacheable indefinitely, and stay in sync with whatever we ship:

```
https://www.ape.church/images/pnls/one.png
https://www.ape.church/images/pnls/two.png
https://www.ape.church/images/pnls/three.png
https://www.ape.church/images/pnls/four.png
https://www.ape.church/images/pnls/five.png
https://www.ape.church/images/pnls/six.png
https://www.ape.church/images/pnls/seven.png
https://www.ape.church/images/pnls/eight.png
https://www.ape.church/images/pnls/nine.png
https://www.ape.church/images/pnls/ten.png
```

Recommended fetch behavior:

- **Cache aggressively.** Store the bytes on disk on first fetch and key by the URL (or by an ETag from the response if present). These files only change when we deploy new art, which is rare; a 24h–7d TTL is reasonable.
- **Pick deterministically per win** so retries always render the same background:
  ```
  index = int(replayId) % 10
  bg    = BACKGROUNDS[index]   // "one" … "ten"
  ```
  Deterministic picking also means a re-upload after a code change in the bot will produce a byte-identical image, keeping `skippedUpload: true` semantics honest.
- **Fail soft.** If the fetch fails or times out (e.g. the site is mid-deploy), fall back to a solid `#000000` background and proceed — the right-side overlay still carries all the stats and the unfurl still works. Don't block the X post on a background fetch.
- **Don't hot-link at render time.** Always fetch into your own buffer before passing to the renderer; libraries like Satori/Resvg expect local bytes, and you don't want to retry the X post just because the CDN hiccuped on the second compositing pass.

None of the above affect unfurl behavior — the only contract that matters is the PNG ending up at the storage path in §3.

---

## 6. Posting to X

Use the same URL shape the manual flow produces, **minus** the `ref` param:

```
https://www.ape.church/games/<slug>?id=<replayId>
```

When X crawls this:

1. `app/games/<slug>/page.tsx` runs `generateMetadata` → `mergeGameReplayMetadata`.
2. `mergeGameReplayMetadata` reads `?id=`, sanitizes the slug, and HEADs the Supabase URL with `next: { revalidate: 120 }`.
3. If the HEAD is 200, the response emits:
   - `og:image` → your PNG
   - `og:image:width` `1320`, `og:image:height` `742`, `og:image:alt`
   - `twitter:card` `summary_large_image` with `twitter:image` → your PNG
4. If the new path 404s, `mergeGameReplayMetadata` falls back to the **legacy** path `pnl-share/<id>.png` (pre-slug-namespacing); if that also 404s, it uses the site-wide `/opengraph-image.png`.

> Practical implication: if you uploaded but the tweet still shows the default OG image, suspect one of (a) the public URL doesn't return 200, (b) X cached an older crawl of the URL — append a harmless query param (e.g. `&v=2`) once, or use the X Card Validator to force a re-crawl, (c) Supabase's CDN hasn't propagated yet — wait a few seconds and retry the HEAD.

---

## 7. Idempotency, retries, races

- The POST is safe to retry. The server pre-checks existence (HEAD) and re-checks after an upload error to absorb the rare "another worker uploaded first" race; both branches respond `skippedUpload: true`.
- The object key is purely a function of `(gameSlug, replayId)`, so retries with the same inputs converge on the same object.
- The bot must not re-upload to overwrite an existing image: Supabase upload is called with `upsert: false`. If you genuinely need to replace an image (e.g. content correction), delete the object first via Supabase admin.

---

## 8. Validation checklist (for bot QA)

Before going live, confirm:

- [ ] `gameSlug` for every supported game matches the slug from `lib/constants/games.ts` after the sanitization rules in §3.
- [ ] `replayId` matches `^\d+$` — strip any quotes, hex prefixes, BigInt suffixes.
- [ ] HEAD on the public URL returns 200 within ~2s after `POST /upload` returns success.
- [ ] Posting `https://www.ape.church/games/<slug>?id=<replayId>` to the X Card Validator (`https://cards-dev.twitter.com/validator`) shows the uploaded PNG.
- [ ] The PNG passes the size + magic-byte checks: 32 B – 2.5 MB, starts with `89 50 4E 47 0D 0A 1A 0A`.
- [ ] `?ref=` is **not** present in the tweeted URL.
- [ ] Probing an `id` that doesn't exist still cleanly returns `{ "exists": false }` without throwing.
- [ ] A second POST for the same `(slug, id)` returns `skippedUpload: true` — the bot must not treat that as an error.

---

## 9. Open extension points

If the bot team wants the web side to do more of the work, the following are reasonable follow-ups to discuss — none are implemented today:

1. **Server-side render endpoint.** A new `POST /api/pnl-share/render` that takes `{ gameId, gameSlug, gameTitle, totalPayout, pnlPercentage, wagered, profit, playerAddress }`, renders the card on the server (Satori or Puppeteer), and uploads in one round-trip. Removes the need for the bot to ship a renderer.
2. **Bot-only auth.** Today the upload endpoint is open. If we start gating it (HMAC header, service token, IP allowlist), the bot's POST must add the credential — same body otherwise.
3. **Pre-rendered "house" cards.** For wins by anonymous addresses where you don't want to display any profile, you could pass `playerProfile: null` and accept the centered-QR variant — already supported by the layout.

Ping the web team before relying on any of these.
