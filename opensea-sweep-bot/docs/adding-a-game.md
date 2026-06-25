# Adding a new game to the wins system

This is the canonical checklist for wiring a newly-launched game into the two
`opensea-sweep-bot` watchers that consume on-chain `GameEnded` events:

1. **DB watcher** — the WSS listener (`src/wins/listener.ts`) subscribes to
   `GameEnded` and writes every event to the Supabase `game_ended_events` table
   (source of truth, via `src/wins/sink.ts`).
2. **Big-wins X broadcaster** — the same listener also hands each event to the
   broadcaster (`src/wins/broadcaster.ts`), which applies the big-win thresholds
   and posts a tweet. (A fallback poller in `src/wins/source.ts` reads the same
   Supabase table; it's disabled by default — see `WINS_POLLER_ENABLED`.)

Both watchers are driven off the **same registry**, so you do *not* edit a list
in each watcher separately.

---

## The one-line summary

> Add the game's contract address to **`GAME_NAMES`** and **`GAME_SLUGS`** in
> [`src/config.ts`](../src/config.ts), then rebuild and restart. That's it.

`TRACKED_GAME_ADDRESSES` (the set of contracts the listener subscribes to) is
derived from `GAME_NAMES`:

```ts
export const TRACKED_GAME_ADDRESSES = Object.keys(GAME_NAMES) as `0x${string}`[];
```

So adding the game to `GAME_NAMES` simultaneously:
- subscribes the listener's `watchContractEvent` to that contract → events flow
  into `game_ended_events` (DB watcher), **and**
- makes those events eligible for the big-wins broadcaster (X watcher), **and**
- gives the win tweet a human-readable game name (`deriveGameName`).

`GAME_SLUGS` is separate because it only controls the optional replay link
appended to the tweet (`${APE_CHURCH_BASE_URL}/games/<slug>?id=<replayId>`). A
game missing from `GAME_SLUGS` still gets tracked and tweeted — just without the
link. Keep the two maps in sync.

---

## What you need to collect (and what you don't)

To register a game you need exactly **three** things:

| Field | Example | Used for |
| --- | --- | --- |
| **Contract address** | `0x46F36097…CDb8903` | The map **key** (lowercased). Drives the listener subscription + every lookup. |
| **Display name** | `Poison The King` | `GAME_NAMES` value — the human name in the tweet. Free-form. |
| **URL slug** | `poison-the-king` | `GAME_SLUGS` value — the `/games/<slug>` path for the replay link. Must match the live web-app route. Lowercase kebab-case only (`^[a-z0-9]+(-[a-z0-9]+)*$`). |

> **You do NOT need the game's numeric ID.** A game is identified throughout this
> pipeline by its **contract address**, never by a catalog number like "game 37".
> The `gameId` field that appears in the on-chain `GameEnded` event is the
> *per-play round number*; the listener stores it per-row in Supabase and reuses
> it as the `?id=` on the replay link — it is read off-chain automatically and is
> nothing you configure here. If someone hands you a game ID, you can ignore it
> for this task.

---

## Step-by-step

### 1. Get the game's contract address

This is the deployed game contract that emits `GameEnded(user, gameId, buyIn,
payout)`. It's usually the same address used by that game's resolver process at
the repo root (e.g. `futbol-game-processor.js` → `GAME_CONTRACT_ADDRESS`).

### 2. Add it to both maps in `src/config.ts`

**Lowercase the address** — every lookup in `formatter.ts` does
`address.toLowerCase()`, and `GAME_NAMES` keys are documented as MUST-be-lowercase.

```ts
// GAME_SLUGS — replay-link slug (the path segment under /games/)
'0x6eaeb51ffa0bb99c3ae6502bb678f560930b55ad': 'futbol-frenzy',

// GAME_NAMES — human-readable display name shown in the tweet
'0x6eaeb51ffa0bb99c3ae6502bb678f560930b55ad': 'Futbol Frenzy',
```

- The **slug** must match the actual web-app route at
  `https://www.ape.church/games/<slug>` or the replay link will 404.
- The **display name** is free-form (e.g. `Blackjack`, `Slots (DinoDough)`).

### 3. Rebuild and restart

```bash
cd ~/ape-church-quests
git pull
cd opensea-sweep-bot
npm run build
pm2 restart opensea-sweep-bot
```

### 4. Verify

On restart the listener logs how many games it's tracking — confirm the count
went up by one:

```bash
pm2 logs opensea-sweep-bot --lines 50 | grep listener
# [listener] starting; tracking N game(s)
# [listener] subscribed to GameEnded
```

After the game sees its first plays, confirm rows are landing in Supabase
(`game_ended_events`, filtered by `game_address`) and that a qualifying win
produces a `[wins] published ...` log line.

---

## Worked example — "Poison The King"

Given a new game:

- Address: `0x46F3609778B716A50e669861f566b7793CDb8903`
- Name: `Poison The King`
- Slug: `poison-the-king`

Lowercase the address and append one line to **each** map in
[`src/config.ts`](../src/config.ts):

```ts
// in GAME_SLUGS
'0x46f3609778b716a50e669861f566b7793cdb8903': 'poison-the-king',

// in GAME_NAMES
'0x46f3609778b716a50e669861f566b7793cdb8903': 'Poison The King',
```

Then build, test, and restart:

```bash
cd opensea-sweep-bot
npm run build      # tsc — must exit 0
npm test           # vitest — the map-hygiene tests fail if a key isn't
                   #   lowercase or a slug isn't kebab-case
pm2 restart opensea-sweep-bot
```

`npm test` is your safety net: `src/wins/wins.test.ts` asserts every
`GAME_NAMES`/`GAME_SLUGS` key is lowercase and every slug matches
`^[a-z0-9]+(-[a-z0-9]+)*$`. If you forget to lowercase the address or fat-finger
the slug, the test goes red before anything ships.

---

## Notes / gotchas

- **One address per game.** If a game is redeployed to a new contract, add the
  new address (and remove or keep the old one — old one keeps historical events
  flowing but emits nothing once retired).
- **First-boot behaviour:** the listener anchors at chain head on first run and
  does not backfill unbounded history (see `WINS_BACKFILL_BLOCKS_MAX`). Adding a
  game mid-life starts tracking from the restart point forward; it will not
  retroactively ingest the game's pre-registration plays beyond the backfill cap.
- **Graceful degradation:** a contract that emits `GameEnded` but is missing from
  `GAME_NAMES` is simply never subscribed to (no DB rows, no tweets). A tracked
  contract missing only from `GAME_SLUGS` still works — tweets just omit the
  replay link.
- The root-level `*-processor.js` files (e.g. `futbol-game-processor.js`,
  `gotg-processor.js`) are **separate** on-chain game *resolvers*, not part of
  this wins pipeline. Registering a game here does not configure its resolver,
  and vice-versa.
