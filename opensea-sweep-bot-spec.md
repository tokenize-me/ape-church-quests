# OpenSea Sweep Bot — Build Specification

## Overview

A Node.js bot that watches a specific wallet (the "deployer") for NFT purchases on OpenSea across Ethereum and ApeChain, detects sweeps (multiple NFTs bought in a single transaction), and posts formatted announcements to a dedicated Twitter/X account with images of the swept NFTs.

The bot exists to publicly highlight when the project sweeps NFTs from other communities to fill NFT Packs (a product where users spend in-game currency for a chance to win NFTs).

---

## Goals

- Detect when the deployer wallet buys NFTs on OpenSea (Ethereum or ApeChain)
- Group multiple NFT purchases from a single transaction into one "sweep" event
- Post a tweet announcing each sweep with native-currency totals and NFT images
- Run reliably as a long-lived process on the existing Digital Ocean droplet under PM2

## Non-Goals

- Multi-chain sweep detection within a single transaction (sweeps are always single-chain by design)
- USD conversion or price feeds (native currency only — APE or ETH)
- Retry logic for failed tweets (free-tier Twitter quota is precious; better to skip than burn quota)
- Persisting in-flight aggregation buffer across restarts (occasional missed sweeps are acceptable)
- Coverage of marketplaces other than OpenSea

---

## Tech Stack

- **Runtime:** Node.js (latest LTS), TypeScript
- **Process manager:** PM2 (single process, no clustering)
- **Database:** SQLite via `better-sqlite3` (synchronous API, simple, fast)
- **Hosting:** Existing Digital Ocean droplet
- **External APIs:**
  - OpenSea Stream API via `@opensea/stream-js`
  - OpenSea REST API v2 (fallback for backfill, if needed)
  - Twitter/X API v2 (free tier) via `twitter-api-v2` package
- **Image processing:** `sharp` for collage generation
- **HTTP client:** native `fetch` or `axios` (pick one and stick with it)

---

## Architecture

### Process model

Single Node.js process, managed by PM2. No clustering — the in-memory aggregation buffer must live in one process, and the workload (a few sweeps per day) doesn't require horizontal scaling.

PM2 config requirements:
- `autorestart: true`
- `max_restarts: 10` within `min_uptime: '5m'` (prevents infinite restart loops)
- `exp_backoff_restart_delay: 1000`
- Log rotation via `pm2-logrotate`

### Directory layout

```
opensea-sweep-bot/
├── src/
│   ├── index.ts                    # Entry point — wires modules, starts stream manager
│   ├── config.ts                   # Constants: DEPLOYER_ADDRESS, CHAINS, QUIET_PERIOD_MS, templates
│   │
│   ├── stream/
│   │   ├── manager.ts              # Owns N stream clients; dedup + buyer-side filter
│   │   └── client.ts               # One OpenSea Stream API connection with reconnect logic
│   │
│   ├── aggregator/
│   │   ├── buffer.ts               # Tx-hash keyed buffer with debounce timer
│   │   └── types.ts                # SaleEvent, SweepDetected interfaces
│   │
│   ├── formatter/
│   │   ├── tweet.ts                # SweepDetected → tweet text
│   │   └── format-helpers.ts       # Number formatting per currency
│   │
│   ├── images/
│   │   ├── selector.ts             # Picks which NFTs to show
│   │   ├── downloader.ts           # Fetches NFT images from CDN with timeout/retry
│   │   └── collage.ts              # Sharp-based grid generation
│   │
│   ├── publisher/
│   │   └── twitter.ts              # X API v2 client; media upload + tweet post
│   │
│   └── storage/
│       ├── db.ts                   # SQLite connection + schema init
│       └── queries.ts              # Typed query functions
│
├── data/
│   └── sweeps.db                   # SQLite file (gitignored)
│
├── logs/                           # PM2 log destination (gitignored)
├── tmp/                            # Temp collage files (gitignored, cleaned periodically)
│
├── ecosystem.config.js             # PM2 process definition
├── package.json
├── tsconfig.json
├── .env                            # Twitter + OpenSea API keys (gitignored)
├── .env.example
└── README.md
```

---

## Configuration

All non-secret config lives in `src/config.ts`. All secrets live in `.env`.

### `src/config.ts` requirements

Must export:

- `DEPLOYER_ADDRESS` — hardcoded wallet address, lowercased for comparison (the user has confirmed this is not a secret and won't change)
- `CHAINS` — array of chain configs:
  ```ts
  [
    { id: 'ethereum',  displayName: 'Ethereum', currency: 'ETH', decimals: 4 },
    { id: 'ape_chain', displayName: 'ApeChain', currency: 'APE', decimals: 2 },
  ]
  ```
  (Verify exact chain ID strings against OpenSea Stream API docs during implementation — `ape_chain` may be `apechain`. Source of truth: https://docs.opensea.io)
- `QUIET_PERIOD_MS` — `15000` (15 seconds; tunable)
- `RECONNECT_BACKOFF` — `{ initialMs: 1000, maxMs: 60000, multiplier: 2 }`
- `TWEET_TEMPLATES`:
  ```ts
  {
    single: 'ApeChurch Deployer picked up a {collectionName} NFT for {price} {currency}.',
    multi:  'ApeChurch Deployer has swept {count} {collectionName} NFTs for a total cost of {total} {currency}, purchasing each NFT at an average price of {average} {currency}.',
  }
  ```
- `IMAGE_GRID_LAYOUT` — count → `{ cols, rows }`:
  ```
  1–4    → use Twitter native grid (no sharp)
  5–6    → 3x2
  7–9    → 3x3
  10–12  → 4x3
  13–16  → 4x4
  17–20  → 5x4
  21–25  → 5x5
  26+    → 5x5, truncate to first 25
  ```
- `COLLAGE_SIZE_PX` — `1200` (final composite is 1200x1200)
- `IMAGE_DOWNLOAD_TIMEOUT_MS` — `5000`

### `.env` requirements (must have `.env.example` checked in)

```
OPENSEA_API_KEY=
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_TOKEN_SECRET=
```

Note: media uploads require OAuth 1.0a user context (the four-key set above), not just a bearer token. Use `twitter-api-v2`'s OAuth 1.0a client mode.

---

## Module specifications

### `src/aggregator/types.ts`

Define the core types used throughout the pipeline.

```ts
export interface SaleEvent {
  eventId: string;          // OpenSea event UUID, used for dedup
  chain: 'ethereum' | 'ape_chain';
  txHash: string;
  buyer: string;            // lowercased
  seller: string;           // lowercased
  collectionSlug: string;
  collectionName: string;
  tokenId: string;
  contractAddress: string;
  imageUrl: string | null;  // OpenSea CDN URL
  priceNative: number;      // in native currency units (not wei)
  currency: 'ETH' | 'APE';
  timestamp: number;        // unix seconds
}

export interface SweepDetected {
  chain: 'ethereum' | 'ape_chain';
  txHash: string;
  collectionSlug: string;
  collectionName: string;
  currency: 'ETH' | 'APE';
  decimals: number;         // 2 for APE, 4 for ETH
  nfts: Array<{
    tokenId: string;
    imageUrl: string | null;
    priceNative: number;
  }>;
  totalNative: number;
  averageNative: number;
  timestamp: number;        // earliest event timestamp in the group
}
```

### `src/storage/db.ts` + `queries.ts`

SQLite via `better-sqlite3`. DB file at `./data/sweeps.db`. Schema initialization on startup (idempotent — use `CREATE TABLE IF NOT EXISTS`).

Schema:

```sql
CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_tx
  ON processed_events(chain, tx_hash);

CREATE TABLE IF NOT EXISTS published_sweeps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  collection_slug TEXT NOT NULL,
  collection_name TEXT NOT NULL,
  nft_count INTEGER NOT NULL,
  total_cost_native REAL NOT NULL,
  currency TEXT NOT NULL,
  tweet_id TEXT,
  tweet_text TEXT NOT NULL,
  nfts_json TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  UNIQUE(chain, tx_hash)
);
```

The `UNIQUE(chain, tx_hash)` constraint on `published_sweeps` is the safety net against double-tweets even if logic upstream misfires.

Required query functions in `queries.ts`:

- `isEventProcessed(eventId: string): boolean`
- `markEventProcessed(event: SaleEvent): void`
- `isSweepPublished(chain: string, txHash: string): boolean`
- `recordPublishedSweep(sweep: SweepDetected, tweetId: string, tweetText: string): void`

Acceptance criteria:
- Schema creation is idempotent
- `markEventProcessed` is a no-op if event_id already exists (use `INSERT OR IGNORE`)
- `recordPublishedSweep` throws if `(chain, tx_hash)` already exists — caller must catch and skip

### `src/aggregator/buffer.ts`

The core sweep-detection logic. Highest-risk module — must be unit-tested with fake timers before integrating with the live stream.

API:

```ts
class SweepBuffer {
  constructor(
    quietPeriodMs: number,
    onSweep: (sweep: SweepDetected) => Promise<void>,
  );

  addEvent(event: SaleEvent): void;
  flushAll(): Promise<void>;  // for graceful shutdown
}
```

Behavior:

- Internal `Map<string, { events: SaleEvent[]; timer: NodeJS.Timeout }>` keyed by `${chain}:${txHash}`
- On `addEvent`:
  1. Compute key from event
  2. If entry exists, clear existing timer; otherwise create new entry with empty events array
  3. Push event into entry's events array
  4. Set new timer with `quietPeriodMs` delay calling internal `flush(key)`
- On `flush(key)`:
  1. Remove entry from map
  2. If a `flushAll` is in progress, await it first
  3. Build `SweepDetected` from collected events:
     - All events in a sweep must share the same `collectionSlug` (sanity check; if not, log warning and use the first collection's slug — multi-collection sweeps are out of scope)
     - `totalNative` = sum of `priceNative`
     - `averageNative` = `totalNative / events.length`
     - `timestamp` = min of event timestamps
  4. Call `onSweep(sweep)` and await it; catch errors and log (don't crash the buffer)
- `flushAll`:
  - Used by graceful shutdown
  - Immediately fires `flush(key)` for every entry currently in the buffer

Unit tests required:
- Single event → flushes after quiet period
- Multiple events for same tx within quiet period → flushes once with all events
- Events for different txs → independent flushes
- Timer resets correctly when new event arrives mid-window
- Multi-chain isolation (same tx hash on different chains → two separate flushes)

### `src/stream/client.ts`

Wraps one `@opensea/stream-js` connection. One instance per chain.

API:

```ts
class StreamClient {
  constructor(
    chain: 'ethereum' | 'ape_chain',
    apiKey: string,
    onEvent: (event: SaleEvent) => void,
  );

  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
```

Behavior:

- On `connect()`: open a Stream API connection for this chain, subscribe to `item-sold` (item-listed-and-sold) events on collection slug `*` (wildcard — verify exact syntax against SDK docs during implementation)
- For each received event:
  - Parse into our normalized `SaleEvent` shape
  - Call `onEvent(event)` synchronously (no awaiting; downstream pipeline handles its own async)
- On disconnect: reconnect with exponential backoff (1s → 2s → 4s → ... → max 60s)
- On reconnect: do NOT attempt to backfill missed events (per "accept the loss" decision)
- Log all connect/disconnect/error events

Important: the OpenSea Stream API filters primarily by collection slug. Account-level filtering may not exist as a server-side filter. If so, subscribe to all collections (wildcard) and filter buyer-side in `manager.ts`. Confirm during implementation by reading the SDK README at https://github.com/ProjectOpenSea/stream-js.

### `src/stream/manager.ts`

Owns one `StreamClient` per chain in `CHAINS`. Single point of contact for the aggregator.

API:

```ts
class StreamManager {
  constructor(
    apiKey: string,
    deployerAddress: string,
    onRelevantSale: (event: SaleEvent) => void,
  );

  start(): Promise<void>;
  stop(): Promise<void>;
}
```

Behavior:

- On `start()`: instantiate one `StreamClient` per chain, connect them all
- Event handler for each client:
  1. Check `event.buyer === deployerAddress` (case-insensitive); discard if not
  2. Check `isEventProcessed(event.eventId)`; discard if true
  3. Call `markEventProcessed(event)`
  4. Forward to `onRelevantSale`
- On `stop()`: disconnect all clients

### `src/formatter/format-helpers.ts`

Pure functions for number formatting.

```ts
function formatNative(amount: number, currency: 'ETH' | 'APE'): string;
// APE → 2 decimals, comma separators for thousands: "1,750.00"
// ETH → 4 decimals, comma separators for thousands: "1.2345"

function formatCount(n: number): string;
// "1", "25", "1,250" — comma separators above 999
```

Unit tests:
- `formatNative(1750, 'APE')` → `'1,750.00'`
- `formatNative(87.5, 'APE')` → `'87.50'`
- `formatNative(0.025, 'ETH')` → `'0.0250'`
- `formatNative(1.23456789, 'ETH')` → `'1.2346'`

### `src/formatter/tweet.ts`

Pure function. Inputs: `SweepDetected`. Output: `{ text: string }`.

```ts
function buildTweet(sweep: SweepDetected): { text: string };
```

Branches:
- `sweep.nfts.length === 1` → use `TWEET_TEMPLATES.single`, fill `{collectionName}`, `{price}`, `{currency}`
- `sweep.nfts.length > 1` → use `TWEET_TEMPLATES.multi`, fill `{count}`, `{collectionName}`, `{total}`, `{average}`, `{currency}`

All numeric fields use `formatNative`. The count field uses `formatCount`.

Unit tests cover both branches and edge cases (very large counts, fractional prices).

### `src/images/selector.ts`

```ts
function selectImagesToShow(sweep: SweepDetected): string[];
// Returns up to 25 image URLs in display order.
// Strategy: take first N from sweep.nfts where imageUrl is non-null.
// If fewer than 4 have images, return what we have — Twitter native grid handles 1-4.
```

### `src/images/downloader.ts`

```ts
async function downloadImages(
  urls: string[],
  timeoutMs: number,
): Promise<Buffer[]>;
// Fetches in parallel with per-image timeout.
// One retry on failure.
// On total failure for an image, omits it from the returned array (does not throw).
```

### `src/images/collage.ts`

Uses `sharp`. Only called when count > 4.

```ts
async function buildCollage(
  imageBuffers: Buffer[],
  count: number,
): Promise<Buffer>;
// Look up grid dimensions from IMAGE_GRID_LAYOUT[count].
// Resize each tile to (COLLAGE_SIZE_PX / cols) × (COLLAGE_SIZE_PX / rows) with fit: 'cover'.
// Composite onto a 1200x1200 black or neutral background.
// Return JPEG buffer.
```

Acceptance:
- 8 images on a 3x3 grid produces a valid JPEG with one empty (background-colored) cell
- Handles non-square source images without distortion (cover crop)
- Output is under 5MB (Twitter's per-image limit) — quality setting tuned to fit

### `src/publisher/twitter.ts`

```ts
async function publishSweep(
  sweep: SweepDetected,
  text: string,
  imageBuffers: Buffer[],
  isCollage: boolean,
): Promise<string>;
// Returns posted tweet ID on success; throws on failure.
```

Behavior:

- If `imageBuffers` is empty: post text-only tweet
- If `isCollage` is true: upload the single collage buffer, attach, post
- If `isCollage` is false: upload each buffer separately (up to 4), attach all media IDs, post
- Use OAuth 1.0a user-context auth via `twitter-api-v2`
- On any error: log full error, throw to caller

Caller (in `index.ts`) catches and does NOT retry — preserving free-tier quota and avoiding noisy logs.

### `src/index.ts`

Entry point. Wires all modules together.

Startup sequence:

1. Load `.env` (use `dotenv`)
2. Initialize SQLite DB and run schema
3. Construct `SweepBuffer` with `onSweep` handler that runs the full publish pipeline:
   ```
   onSweep(sweep):
     if isSweepPublished(sweep.chain, sweep.txHash): return  // safety
     text = buildTweet(sweep).text
     urls = selectImagesToShow(sweep)
     buffers = await downloadImages(urls, IMAGE_DOWNLOAD_TIMEOUT_MS)
     isCollage = buffers.length > 4
     finalBuffers = isCollage ? [await buildCollage(buffers, buffers.length)] : buffers
     try:
       tweetId = await publishSweep(sweep, text, finalBuffers, isCollage)
       recordPublishedSweep(sweep, tweetId, text)
     catch err:
       log error, continue (no retry)
   ```
4. Construct `StreamManager` with `onRelevantSale` handler that calls `buffer.addEvent(event)`
5. Call `manager.start()`
6. Register SIGTERM/SIGINT handler:
   - Stop accepting new events (`manager.stop()`)
   - Wait up to 5s for `buffer.flushAll()` to complete
   - Close DB
   - Exit

Add a `DRY_RUN` environment flag: if set, the publisher logs the tweet + image count instead of actually posting. Useful for testing the full pipeline against live OpenSea events without spending Twitter quota.

---

## Failure handling reference

| Failure | Response |
|---|---|
| Websocket disconnect | Auto-reconnect with exponential backoff; events during gap are lost |
| Process crash during 15s buffer window | Buffer lost, sweep missed (accepted) |
| OpenSea CDN image fetch fails | Skip that image; post tweet with whatever images succeeded |
| All images fail to download | Post text-only tweet |
| Twitter API failure | Log error, do not retry, do not mark as published |
| SQLite write failure | Log and crash; PM2 restarts the process |
| Duplicate event from Stream API | Filtered by `processed_events` primary key |
| Same tx somehow re-detected | Blocked by `UNIQUE(chain, tx_hash)` on `published_sweeps` |

---

## Build order

Each step produces a runnable, testable artifact. Do not move to the next step until the current one is verified working.

1. **Scaffold the project** — `package.json`, `tsconfig.json`, directory structure, `.env.example`, empty `ecosystem.config.js`. Verify `npm run build` succeeds on empty stubs.

2. **`config.ts` + `aggregator/types.ts`** — define all constants and types. Everything else compiles against these.

3. **`storage/db.ts` + `queries.ts`** — SQLite schema and query functions. Write a small standalone test script that creates the DB, inserts a fake event, queries it back, attempts a duplicate insert, attempts a duplicate sweep publish (must throw). Delete the script when done.

4. **`aggregator/buffer.ts`** — implement and unit-test in isolation with fake timers (Jest `useFakeTimers` or similar). All five test cases listed in the buffer section must pass before moving on.

5. **`formatter/format-helpers.ts` + `formatter/tweet.ts`** — implement and unit-test. All formatting examples in the spec must produce exact expected output.

6. **`images/selector.ts` + `images/downloader.ts` + `images/collage.ts`** — implement. Write a standalone test script that takes a list of real OpenSea CDN image URLs (find some by browsing opensea.io), downloads them, generates a 3x3 collage, writes it to disk for visual inspection. Verify the output looks correct, then delete the script.

7. **`stream/client.ts` + `stream/manager.ts`** — implement. Run in a "log only" mode that prints every received sale event but does not push to the aggregator. Verify in production for a few hours that events flow through correctly, that the buyer-side filter catches deployer wallet purchases, and that reconnects work after a forced disconnect.

8. **`publisher/twitter.ts`** — implement. Test against a throwaway Twitter account first: post a text-only tweet, then a tweet with one image, then a tweet with four images, then a tweet with a single collage image.

9. **`index.ts` wiring** — connect everything. Run with `DRY_RUN=true` first against live OpenSea events for at least 24 hours to confirm sweeps are detected and tweet text + image selection look right without actually posting. Then flip to live mode.

10. **PM2 + deployment** — finalize `ecosystem.config.js`, document deployment in `README.md`, deploy to droplet, verify it survives a `pm2 restart`.

---

## Open implementation questions

Things the spec deliberately does NOT lock down, because they're best confirmed against live docs/code rather than guessed:

- **Exact OpenSea Stream API chain ID strings.** Spec says `'ape_chain'` and `'ethereum'` — verify against the `@opensea/stream-js` SDK and OpenSea docs at build time.
- **OpenSea Stream API event payload shape.** Spec assumes `item-sold` events include buyer, price, image URL, etc. Map the actual payload to the `SaleEvent` interface during implementation; adjust the interface if needed.
- **Whether OS2 cross-chain purchases (e.g., buying an ApeChain NFT with ETH) fire one event or two.** Likely one event on the destination chain (ApeChain) with the actual paid currency reflected. Worth testing during the "log only" phase by doing a small test sweep and observing what fires.
- **Twitter media upload limits and chunking.** For images up to 5MB, simple upload works; if collages occasionally exceed this, may need chunked upload via `twitter-api-v2`'s `uploadMedia` helper.

---

## Definition of done

The bot is considered complete when:

1. All modules pass their specified unit tests
2. Running with `DRY_RUN=true`, the bot correctly detects and logs a real sweep made by the deployer wallet on both Ethereum and ApeChain
3. Running live, the bot posts a correctly formatted tweet with images for a real deployer-wallet sweep
4. The bot survives `pm2 restart opensea-sweep-bot` and continues processing new events
5. Duplicate detection works: manually re-inserting an event into the buffer (via a debug hook or by replaying a Stream event) does not produce a second tweet
6. `README.md` documents environment setup, deployment, common operations (restart, view logs, query the SQLite DB for recent sweeps)
