# opensea-sweep-bot

Watches the deployer wallet (`0x0d69...FE40`) for NFT purchases on OpenSea (Ethereum + ApeChain), groups multi-NFT purchases in a single transaction into a "sweep," and posts an announcement tweet to X.

Lives as a subproject inside `ape-church-quests`. Reads from the **shared root `.env`** (`../.env`) — never add a local `.env` in this directory.

---

## Quick operations reference

### First-time setup on the droplet

```bash
cd ~/ape-church-quests
git pull
cd opensea-sweep-bot
npm install
npm run build
```

Then add the bot's keys to the shared root `.env` (see [`.env.example`](./.env.example) for the list).

### Starting under PM2

```bash
# From repo root, OR from inside opensea-sweep-bot/ — both work:
pm2 start opensea-sweep-bot/ecosystem.config.js
```

This is the rough equivalent of `pm2 start bot.js` you use for the other services — the ecosystem file just adds autorestart/log-rotation/restart-cap settings appropriate for a long-lived stream subscriber.

### Day-to-day

```bash
pm2 status                                # see the bot alongside other services
pm2 logs opensea-sweep-bot                # tail combined logs
pm2 logs opensea-sweep-bot --err          # errors only
pm2 restart opensea-sweep-bot             # after deploying changes
pm2 stop opensea-sweep-bot
pm2 delete opensea-sweep-bot              # full unregister
```

### Updating after a code change

```bash
cd ~/ape-church-quests
git pull
cd opensea-sweep-bot
npm install            # only if package.json changed
npm run build
pm2 restart opensea-sweep-bot
```

### Inspecting the SQLite database

```bash
sqlite3 opensea-sweep-bot/data/sweeps.db
sqlite> .tables
sqlite> SELECT chain, tx_hash, nft_count, total_cost_native, currency, datetime(published_at, 'unixepoch')
        FROM published_sweeps
        ORDER BY published_at DESC
        LIMIT 20;
```

### Running modes (set via shared `.env`)

| Env var | Effect |
|---|---|
| `DRY_RUN=true` | Sweep detection runs as normal but no tweet is posted; the publisher logs `{ text, mediaCount }` instead |
| `STREAM_LOG_ONLY=true` | Stream events are logged but never forwarded to the aggregator — used during the Phase 7 observation phase |

Flip flags by editing the shared `.env` and `pm2 restart opensea-sweep-bot`.

---

For build phases and architecture decisions, see [`../opensea-sweep-bot-plan.md`](../opensea-sweep-bot-plan.md) and [`../opensea-sweep-bot-spec.md`](../opensea-sweep-bot-spec.md).
