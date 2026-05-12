# OpenSea Sweep Bot — Implementation Plan

Living checklist for the build described in [`opensea-sweep-bot-spec.md`](./opensea-sweep-bot-spec.md). Tick items as we complete them; add notes inline when reality diverges from spec.

---

## Repo integration conventions (load-bearing for all phases)

This bot lives **inside** the existing `ape-church-quests` repo (the one already deployed to the Digital Ocean droplet under PM2 alongside `index.js`, `crosschainnft.js`, `notify.js`, etc.). Conventions:

- **Shared `.env`**: secrets live in the repo-root `.env` (`../../.env` from `src/index.ts`). The bot loads it explicitly via `dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') })` so it works from any cwd. **Never** add a local `.env` inside `opensea-sweep-bot/`. The local `.env.example` exists only as a reference for which keys to add to the shared file.
- **Isolated `node_modules` / build / data**: the bot has its own `package.json`, `node_modules/`, `dist/`, `data/sweeps.db`, `logs/`, `tmp/`. None of these conflict with the root JS scripts.
- **PM2**: launched via `opensea-sweep-bot/ecosystem.config.js`. All paths inside that config are absolute (derived from `__dirname`), so `pm2 start ./opensea-sweep-bot/ecosystem.config.js` works from repo root and `pm2 start ./ecosystem.config.js` works from the bot subdir. The existing droplet PM2 state is not touched — we just add one new app.
- **No interference with existing root scripts**: the root `package.json` (CommonJS, ethers/viem/supabase) stays untouched. The bot uses TypeScript + its own deps and never imports from `../`.
- **Deployment on droplet**: `git pull` → `cd opensea-sweep-bot && npm install && npm run build` → `pm2 start ecosystem.config.js` (or `pm2 restart opensea-sweep-bot` after the first start).

---

## Phase 0 — Open questions to resolve BEFORE writing code

The spec leaves a few decisions intentionally open. Research notes below; user input wanted on the ones marked **❓**.

### O.1 — Stream API architecture (spec deviation discovered)

The spec describes "one `StreamClient` per chain" with a `CHAINS` array. Reality from reading [`stream-js/src/types.ts`](https://github.com/ProjectOpenSea/stream-js/blob/main/src/types.ts):

- `Network` enum has exactly **one value**: `MAINNET = "mainnet"`. There is no per-chain socket.
- One single websocket at `wss://stream-api.opensea.io/socket` carries events for **all chains** OpenSea supports (Ethereum, ApeChain, Base, etc.).
- Each event payload carries a `chain: string` field (lowercase chain name) we filter on.

**Implication:** collapse `StreamManager` + `StreamClient` into a single connection. We still iterate `CHAINS` config — but only to know which chain strings to accept and how to format them.

- [x] Decision recorded — **single stream connection, chain filter applied buyer-side**

### O.2 — Exact chain string for ApeChain

- [x] **Confirmed: `ape_chain`** (observed in live heartbeat `topChains=[... ape_chain=1 ...]` during Phase 7 log-only run, 2026-05-11). `ACCEPTED_CHAINS` in `src/config.ts` already had the correct value
- [x] **Decision: accept all payment tokens** — tweet template renders `payload.payment_token.symbol` as-is (e.g. "WETH", "USDC"). Decimals come from `payload.payment_token.decimals` so number formatting still works

### O.3 — Dedup key (spec gap)

Spec assumes `event.eventId` is a UUID. `BaseStreamMessage` defines:

```
event_type, version, sent_at, payload
```

No top-level UUID. For dedup we have:
- `payload.order_hash` (unique per order, but a single order can be filled multiple times for ERC-1155)
- `payload.transaction.hash` + `payload.item.nft_id` (chain-prefixed, e.g. `ethereum/0xabc.../42`) — natural composite key for an NFT sale

- [x] Decision: use **`(chain, tx_hash, nft_id)`** as the dedup primary key in `processed_events`. Replace `event_id TEXT PRIMARY KEY` with composite primary key

### O.4 — Twitter/X pricing reality check

- [x] **Decision: provision a new X dev app on the 2026 pay-per-use model** (~$0.01–$0.015/post; cents/month at sweep volume)
- [ ] Provision the X dev app, generate OAuth 1.0a credentials (API key + secret, access token + secret), put in `.env`
- [ ] Set a monthly spend cap on the X billing account as a safety belt

### O.5 — Wallet address to monitor  ❓

`DEPLOYER_ADDRESS` is referenced as "hardcoded… not a secret." We need the actual address before `config.ts`.

- [x] **Deployer wallet: `0x0d69B1D26F56DEE4449f5ED3998B0380aAa2FE40`** (lowercased in code; same EVM address on Ethereum and ApeChain)

### O.6a — Mixed-currency sweep within one tx

Now that we accept any token symbol, a single sweep tx could in theory contain sales in multiple tokens (e.g. 3 NFTs paid in ETH + 1 in WETH in the same Seaport tx). Spec assumes one `currency` per `SweepDetected`.

- [x] **Decision: skip the sweep, log a warning** (Option C). Will essentially never happen in practice; not worth complexity in v1

### O.6 — Cross-chain (OS2) sale shape

- [x] **Decision: avoid by operational discipline.** Deployer will always sweep using native currency on the matching chain (ETH on Ethereum, APE on ApeChain). No code-side handling needed; cross-chain buys will simply not be initiated

---

## Phase 1 — Project scaffold

- [x] **Decision: subdirectory of this repo** — `./opensea-sweep-bot/` inside `ape-church-quests`
- [x] `npm init`, install deps: `@opensea/stream-js`, `ws`, `node-localstorage`, `better-sqlite3`, `twitter-api-v2`, `sharp`, `dotenv`, `typescript`, `@types/node`, `@types/phoenix`, `@types/ws`, `@types/better-sqlite3`, `@types/node-localstorage`, `rimraf`
- [x] `tsconfig.json` (target ES2022, CommonJS modules, strict, noUncheckedIndexedAccess)
- [x] Directory tree — `src/` created with `index.ts` stub. Subdirectories (`stream/`, `aggregator/`, `formatter/`, `images/`, `publisher/`, `storage/`) deferred to their respective phases; `data/`, `logs/`, `tmp/` are gitignored and created at runtime
- [x] `.env.example` checked in (as a reference for which keys to add to the **shared root `.env`** — the bot does not read a local `.env`)
- [x] `src/index.ts` loads `path.resolve(__dirname, '..', '..', '.env')` (repo-root `.env`), verified at runtime
- [x] `.gitignore` covers `.env`, `data/`, `logs/`, `tmp/`, `node_modules/`, `dist/`, `*.log`
- [x] `ecosystem.config.js` placeholder created (used in Phase 10)
- [x] `npm run build` succeeds; `node dist/index.js` prints `opensea-sweep-bot starting`

## Phase 2 — Config + types

- [x] `src/config.ts` with `DEPLOYER_ADDRESS` (lowercased), `ACCEPTED_CHAINS` + `CHAIN_DISPLAY_NAMES`, `QUIET_PERIOD_MS`, `RECONNECT_BACKOFF`, `TWEET_TEMPLATES`, `IMAGE_GRID_LAYOUT` (5–25), `MAX_COLLAGE_IMAGES`, `TWITTER_NATIVE_GRID_MAX`, `COLLAGE_SIZE_PX`, `IMAGE_DOWNLOAD_TIMEOUT_MS`, `DRY_RUN`, `STREAM_LOG_ONLY`
- [x] **Adjustment** done: dropped per-chain `currency`/`decimals` (now per-event from `payment_token`). Chains config collapses to `ACCEPTED_CHAINS` accept-list + `CHAIN_DISPLAY_NAMES` lookup
- [x] Tweet templates use `{currency}` placeholder — filled with `payload.payment_token.symbol` as-is
- [x] `src/aggregator/types.ts` — `SaleEvent`, `SweepDetected` interfaces. Adjusted vs spec: no `eventId`; added `nftId`, `orderHash`; `currency: string`; `decimals: number`; `nfts[]` includes `nftId`
- [x] `npm run build` clean

## Phase 3 — Storage

- [x] `src/storage/db.ts` — `better-sqlite3` connection, `data/sweeps.db` (auto-mkdir), WAL mode, idempotent schema init
- [x] Schema: `processed_events` primary key is composite `(chain, tx_hash, nft_id)`; `published_sweeps` has `UNIQUE(chain, tx_hash)` as the double-tweet safety net
- [x] `src/storage/queries.ts` — `isEventProcessed`, `markEventProcessed` (INSERT OR IGNORE), `isSweepPublished`, `recordPublishedSweep` (throws on UNIQUE conflict)
- [x] Smoke test (now removed) ran 8 assertions: fresh insert, dup-insert no-op, multi-chain isolation on both axes, sweep publish, duplicate sweep publish throws UNIQUE — **all passed**

## Phase 4 — Sweep aggregator (highest-risk module)

- [x] `src/aggregator/buffer.ts` — `SweepBuffer` class with debounced flush per `(chain:txHash)` key
- [x] Vitest added as devDependency; `npm test` / `npm run test:watch` scripts wired
- [x] `**/*.test.ts` excluded from `tsc` build so test files don't end up in `dist/`
- [x] Unit tests — **12/12 passing**:
  - [x] Single event flushes after quiet period
  - [x] Multiple events same tx within window → single flush, all events, correct total/average
  - [x] Different txs → independent flushes
  - [x] Timer resets when new event arrives mid-window (re-armed for full quiet period)
  - [x] Same `txHash` on different chains → two separate flushes, currencies preserved
  - [x] `flushAll()` immediately drains every pending bucket
  - [x] `onSweep` throws → buffer keeps running, error logged, subsequent flushes still work
  - [x] Mixed-currency sweep → skipped + warned (per O.6a decision)
  - [x] Multi-collection sweep → uses first collection + warned
  - [x] `buildSweep` returns null for empty event list
  - [x] `buildSweep` picks minimum timestamp across events
  - [x] `buildSweep` total/average correct for fractional prices

## Phase 5 — Formatters

- [x] `src/formatter/format-helpers.ts` — `formatNative(amount, currency)`, `formatCount(n)`, `displayDecimals(currency)`. Per-symbol decimals map (ETH/WETH=4, APE/WAPE=2, USDC/USDT/DAI=2) with default of 4. Case-insensitive on symbol
- [x] `src/formatter/tweet.ts` — `buildTweet(sweep) → { text }`. Single template for 1-NFT sweeps, multi template otherwise. Uses `replaceAll('{currency}', …)` to fill both occurrences in the multi template
- [x] Unit tests — **16/16 passing** (28/28 total across the project):
  - [x] All four spec examples for `formatNative` (`1750/APE → '1,750.00'`, `87.5/APE → '87.50'`, `0.025/ETH → '0.0250'`, `1.23456789/ETH → '1.2346'`)
  - [x] WETH/WAPE treated as ETH/APE; USDC/USDT use 2 decimals; unknown symbols fall back to 4
  - [x] `formatCount` boundary cases (1, 999, 1000, 1,250,000)
  - [x] Single-NFT tweet renders correctly
  - [x] Multi-NFT tweet renders correctly with both `{currency}` placeholders filled
  - [x] Large counts (1,234 NFTs) get comma separators in the tweet body

## Phase 6 — Images

- [x] `src/images/selector.ts` — `selectImagesToShow(sweep)`: walks `nfts` in order, picks non-null `imageUrl`s, caps at `MAX_COLLAGE_IMAGES` (25)
- [x] `src/images/downloader.ts` — native `fetch` + `AbortController` timeout, 1 retry per URL, omits failures from result, normalizes `ipfs://`, 20MB per-image safety cap, User-Agent header
- [x] `src/images/collage.ts` — `buildCollage(buffers)`: looks up grid from `IMAGE_GRID_LAYOUT[buffers.length]`, sharp resize with `fit:'cover'` + `position:'attention'`, composite onto 1200×1200 dark background (`#1c1c1e`), JPEG quality 85
- [x] Unit tests — **13 new (41/41 total project-wide)**: selector picks/skips/truncates, ipfs:// normalization, parallel fetch order preservation, 1-retry behavior, omit-on-double-failure, non-2xx as failure, content-length oversize rejection, AbortController timeout, empty input
- [x] Visual collage verification — generated JPEGs at 5/7/9/12/16/20/25 image counts via picsum.photos. Eyeballed 7 (3×3 partial fill → 2 dark cells bottom-right) and 16 (4×4 full → perfect tiling). Sizes 174–311 KB, all well under Twitter's 5MB. One-shot script removed; `tmp/` files remain locally (gitignored) for the user to spot-check
- [x] OpenSea CDN smoke test deferred to Phase 7 log-only — the geometry is proven; real-URL fetching is just an integration concern

## Phase 7 — Stream layer

### Code (done)

- [x] `src/stream/parser.ts` — pure `parseItemSoldEvent(raw) → ParsedSaleEvent | null` normalizing the SDK's `ItemSoldEvent` shape into our internal shape. Handles all the field mappings (taker→buyer, maker→seller, nft_id→contract+tokenId, sale_price/10^decimals→priceNative, etc.), lowercases addresses, falls back to collection slug if `item.metadata.name` is null, returns null for malformed payloads
- [x] `src/stream/manager.ts` — `applyFilters(parsed, deps)` pure function (unit-testable) plus `StreamManager` class with a per-minute heartbeat (received + deployer-matched + top chains) and one-time logging of any new chain string we haven't seen before (this is how we'll discover the exact ApeChain key)
- [x] `src/stream/client.ts` — wraps `OpenSeaStreamClient` with the Node-mode setup (`ws` + `node-localstorage` instance at `.opensea-storage/`), subscribes via `client.onItemSold('*', cb)`. Reconnect is delegated to the SDK's phoenix socket
- [x] `src/index.ts` wired for log-only mode: fail-fast if `OPENSEA_API_KEY` missing, start manager + heartbeat, graceful SIGINT/SIGTERM disconnect. Aggregator forwarding is deliberately stubbed (`logOnly: true`) until Phase 9
- [x] Unit tests — **13 new (54/54 total project-wide)**: parser handles ETH/APE/USDC payment tokens, fallback for missing collection name, returns null on malformed nft_id / missing sale_price / unparseable timestamp, lowercases addresses; filter forwards on triple-pass, drops on chain/buyer/duplicate, marks processed only on forward
- [x] `.gitignore` extended with `.opensea-storage/` (phoenix session storage created at first connect)

### Live observation — needs your help (operator steps)

To proceed we need an OpenSea API key in the **shared root `.env`**. The bot will refuse to start without one.

- [ ] Grab a key: `curl -X POST https://api.opensea.io/api/v2/auth/keys` (instant, no signup)
- [ ] Append `OPENSEA_API_KEY=<value>` to `C:\Users\marka\OneDrive\dapps\ape-church-quests\.env`
- [ ] Run `cd opensea-sweep-bot && node dist/index.js` for ≥10 minutes
- [ ] Observation goals (each one updates a different open item):
  - [x] **Heartbeat fires every 60s** with non-zero `received=` counts → confirms the websocket is alive (observed received=50/min, deployer-matches=0 with a non-deployer test buy)
  - [x] **`topChains=[...]`** confirmed ApeChain emits as `ape_chain`. Snapshot: `polygon=25 ronin=17 ethereum=4 base=3 ape_chain=1`
  - [x] **Parse failures**: refactored parser to return `ParseResult` discriminated union with specific reasons. Heartbeat reports `parseFailures=[reason@chain=N]`. Post-refactor live run: `parseFailures=[(none)]` — first run's failures were transient/early-event, not a structural bug
  - [x] **Deployer test purchase** — confirmed working. Live `DEPLOYER BUY chain=ape_chain tx=0x5335... collection=dengs token=4311 price=116.999969 APE` line fired correctly. End-to-end pipeline validated: socket → parser → chain filter → buyer filter → dedup → log

## Phase 8 — Publisher

### Code (done)

- [x] `src/images/mime.ts` — `detectTwitterMime(buf)` magic-byte sniffing, returns one of `image/jpeg|png|webp` or `null`. Animated GIF intentionally omitted (Twitter requires GIF-only tweet rules; not worth supporting for v1)
- [x] `src/publisher/twitter.ts` — `TwitterPublisher` class with a `TwitterClient` interface for DI. `makeRealTwitterClient(creds)` builds the live OAuth 1.0a v1.1/v2 wrapper using `twitter-api-v2`. `publishSweep(text, imageBuffers)` flows:
  - Cap at 4 buffers (Twitter limit)
  - Detect mime per buffer; skip unknowns with a warning
  - Upload each via `v1.uploadMedia(buf, { mimeType })`, collect media IDs
  - If an upload throws → skip that one, continue with the rest
  - Post via `v2.tweet({ text, media: { media_ids } })` (or text-only when no media)
  - Returns `{ tweetId, uploadedMediaCount, skippedMediaCount }`
  - `dryRun: true` short-circuits to a log line; never touches the client
- [x] Unit tests — **8 new (63/63 total project-wide)**: text-only, multi-image with correct mime/order, 4-cap, unknown mime skip, individual upload failure tolerance, all-uploads-fail fallback to text-only, v2.tweet error propagation, dry-run path
- [x] `scripts/twitter-smoke.js` — one-shot live smoke test (text-only + 1 generated image). Supports `--dry` flag for free pipeline validation. Self-deletes per spec convention after running

### Live verification (done)

- [x] X dev app provisioned with OAuth 1.0a read/write perms; four keys added to shared root `.env`
- [x] First live attempt returned HTTP 402 `CreditsDepleted` — auth + perms confirmed correct, billing not yet loaded. User funded pay-per-use credits
- [x] Dry-run smoke: both tweets constructed correctly with `tweetId: 'dry-run'`
- [x] Live smoke (2026-05-12): both tweets posted to the test account, image rendered correctly
- [x] One-shot smoke script removed per spec convention
- [ ] **Open**: decide whether to keep this new account as the real announcement account or swap to a different one before posting real sweeps. Easier to swap now (just rotate the four `.env` keys; no code changes)

## Phase 9 — Wiring

- [x] `src/index.ts` fully wired: requires all 5 env vars, builds publisher, creates `SweepBuffer` with full publish pipeline as `onSweep`, wires `StreamManager.onRelevantSale → buffer.addEvent`, starts heartbeat + stream
- [x] `processSweep` handles: pre-check `isSweepPublished` (in-process safety net), build tweet text, select + download images, branch to native grid (≤4) or collage (≥5), publish, then `recordPublishedSweep` on success
- [x] `DRY_RUN=true` mode: publisher skips real posts AND `recordPublishedSweep` is skipped (so a future live run isn't blocked by dry-run rows)
- [x] Graceful SIGINT/SIGTERM: stop heartbeat, disconnect stream, race `buffer.flushAll()` against a 5s timeout, exit
- [x] Build + 63/63 tests still pass after wiring
- [x] **Soak decision: skip overnight DRY_RUN, go live immediately.** Rationale: announcement account currently has zero followers, so any malformed first tweet can simply be deleted without follower fallout. Reverts to a low-risk live test

## Extension — Big-wins broadcaster (post-spec)

Second use case added: post the platform's biggest wins to the same X account, polling Supabase.

### Decisions
- [x] Single project (shares publisher, DB, X creds, PM2 process). New `src/wins/` directory alongside existing sweep code; no rename of existing modules
- [x] Supabase polling every 60s (vs. contract subscription) — meets "doesn't need to be instant" requirement, leverages existing ingestion
- [x] Two-path criteria (whichever fires first):
  - **Path A (absolute)**: **payout** ≥ **25,000 APE** AND multiplier ≥ **2x** (excludes "huge bet won by a hair"). Free-bet (multiplier=null) bypasses the 2x guard. *(payout, not profit — someone who walks away with 25k+ should post even if they bet 10k to get there)*
  - **Path B (multiplier)**: multiplier ≥ **50x** AND payout ≥ **1,000 APE** (excludes "tiny bet hit fluke multi")
- [x] Tweet copy prefixed with `"BIG WIN ALERT!\n"` — avoids X treating the tweet as a reply when `{playerDisplay}` is an `@handle`
- [x] Display priority: `users.x_handle` (tagged with `@`) → `users.username` → truncated address `0xabcd…fe40`
- [x] Concise stats line template: `"{playerDisplay} won {payout} APE on {gameName} from a {buyIn} APE bet ({multiplier}x)."`
- [x] **Startup-time floor** prevents historical flood on first run — only events with `block_timestamp >= process_start_time` are considered. Trade: restarts lose events during gap (matches "occasional miss acceptable" philosophy)

### Code (done)
- [x] `src/wins/types.ts`, `source.ts`, `selector.ts`, `formatter.ts`, `broadcaster.ts`
- [x] `published_wins` table in SQLite with `event_id` PK as dedup safety net
- [x] `@supabase/supabase-js` dependency added; uses existing `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` from shared root `.env`
- [x] Wired into `src/index.ts` alongside sweeps; graceful shutdown stops both broadcasters
- [x] `GAME_NAMES` populated with 29 platform games (all keys lowercased)
- [x] Test coverage: big-win detection (incl. free-bet edge case), display fallback chain, tweet rendering, game-name lookup case-insensitivity, GAME_NAMES hygiene guard. **102/102 project tests pass**

### Repo hygiene
- [x] Root `.gitignore` updated: `package-lock.json` → `/package-lock.json` (anchored to root only) so `opensea-sweep-bot/package-lock.json` gets committed for reproducible droplet installs

---

## Phase 10 — Deployment

- [ ] `ecosystem.config.js` — autorestart, max_restarts: 10 / min_uptime: 5m, exp_backoff_restart_delay: 1000
- [ ] Install `pm2-logrotate` on droplet, configure rotation
- [ ] `README.md`: env setup, `pm2 start ecosystem.config.js`, `pm2 logs`, `pm2 restart opensea-sweep-bot`, SQLite query examples
- [ ] Deploy to droplet, flip DRY_RUN off, verify with one live sweep
- [ ] Survives `pm2 restart` cleanly

---

## Definition of done (from spec §Definition of done)

- [ ] All module unit tests pass
- [ ] DRY_RUN: real sweep detected and logged correctly on both Ethereum and ApeChain
- [ ] Live: at least one real sweep tweeted with correctly formatted text + images
- [ ] `pm2 restart` survives without losing schema or duplicating tweets
- [ ] Replaying an event doesn't double-tweet (DB constraint verified)
- [ ] README covers setup / deploy / common ops

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| ApeChain not actually streamed on OpenSea Stream API | Medium | Confirm in Phase 7 log-only. Fallback: poll OpenSea REST `events` endpoint on a timer for that chain only |
| Twitter pay-per-use billing surprises | Low (low volume) | Cap monthly spend via X account billing; bot already skips retries to limit waste |
| `payment_token` is WETH/USDC instead of ETH/APE | Medium | Decide whether to filter out non-native or convert. Spec says "native currency only" — easiest is to require `symbol ∈ {ETH, APE}` |
| `sharp` install on droplet (libvips native dep) | Low | Build native bindings during deploy; document in README |
| OpenSea Stream "out of order" / "best effort" delivery causes missed events | Inherent | Spec already accepts loss; document SLA in README |
