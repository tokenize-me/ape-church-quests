import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'sweeps.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS processed_events (
    chain            TEXT    NOT NULL,
    tx_hash          TEXT    NOT NULL,
    nft_id           TEXT    NOT NULL,
    buyer            TEXT    NOT NULL,
    collection_slug  TEXT    NOT NULL,
    price_native     REAL    NOT NULL,
    currency         TEXT    NOT NULL,
    received_at      INTEGER NOT NULL,
    PRIMARY KEY (chain, tx_hash, nft_id)
  );

  CREATE TABLE IF NOT EXISTS published_sweeps (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    chain             TEXT    NOT NULL,
    tx_hash           TEXT    NOT NULL,
    collection_slug   TEXT    NOT NULL,
    collection_name   TEXT    NOT NULL,
    nft_count         INTEGER NOT NULL,
    total_cost_native REAL    NOT NULL,
    currency          TEXT    NOT NULL,
    tweet_id          TEXT,
    tweet_text        TEXT    NOT NULL,
    nfts_json         TEXT    NOT NULL,
    published_at      INTEGER NOT NULL,
    UNIQUE(chain, tx_hash)
  );

  CREATE TABLE IF NOT EXISTS published_wins (
    event_id          TEXT    PRIMARY KEY,
    user_address      TEXT    NOT NULL,
    game_address      TEXT    NOT NULL,
    buy_in_native     REAL    NOT NULL,
    payout_native     REAL    NOT NULL,
    multiplier        REAL,
    tweet_id          TEXT,
    tweet_text        TEXT    NOT NULL,
    published_at      INTEGER NOT NULL
  );

  -- Small key/value store. Currently holds 'wins_last_seen_block' so the
  -- WSS listener can backfill via eth_getLogs after a restart instead of
  -- losing every event that fired while the bot was down.
  CREATE TABLE IF NOT EXISTS cursors (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

export const DB_FILE = DB_PATH;
