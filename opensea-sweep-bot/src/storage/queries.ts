import { db } from './db';
import type { SaleEvent, SweepDetected } from '../aggregator/types';
import type { WinEvent } from '../wins/types';

const stmtIsEventProcessed = db.prepare<
  [string, string, string],
  { one: number }
>(`
  SELECT 1 AS one
  FROM processed_events
  WHERE chain = ? AND tx_hash = ? AND nft_id = ?
  LIMIT 1
`);

const stmtMarkEventProcessed = db.prepare<[
  string, string, string, string, string, number, string, number
]>(`
  INSERT OR IGNORE INTO processed_events
    (chain, tx_hash, nft_id, buyer, collection_slug, price_native, currency, received_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtIsSweepPublished = db.prepare<[string, string], { one: number }>(`
  SELECT 1 AS one
  FROM published_sweeps
  WHERE chain = ? AND tx_hash = ?
  LIMIT 1
`);

const stmtRecordPublishedSweep = db.prepare<[
  string, string, string, string, number, number, string, string, string, string, number
]>(`
  INSERT INTO published_sweeps
    (chain, tx_hash, collection_slug, collection_name, nft_count,
     total_cost_native, currency, tweet_id, tweet_text, nfts_json, published_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function isEventProcessed(
  chain: string,
  txHash: string,
  nftId: string,
): boolean {
  return stmtIsEventProcessed.get(chain, txHash, nftId) !== undefined;
}

export function markEventProcessed(event: SaleEvent): void {
  stmtMarkEventProcessed.run(
    event.chain,
    event.txHash,
    event.nftId,
    event.buyer,
    event.collectionSlug,
    event.priceNative,
    event.currency,
    Math.floor(Date.now() / 1000),
  );
}

export function isSweepPublished(chain: string, txHash: string): boolean {
  return stmtIsSweepPublished.get(chain, txHash) !== undefined;
}

export function recordPublishedSweep(
  sweep: SweepDetected,
  tweetId: string,
  tweetText: string,
): void {
  stmtRecordPublishedSweep.run(
    sweep.chain,
    sweep.txHash,
    sweep.collectionSlug,
    sweep.collectionName,
    sweep.nfts.length,
    sweep.totalNative,
    sweep.currency,
    tweetId,
    tweetText,
    JSON.stringify(sweep.nfts),
    Math.floor(Date.now() / 1000),
  );
}

const stmtIsWinPublished = db.prepare<[string], { one: number }>(`
  SELECT 1 AS one FROM published_wins WHERE event_id = ? LIMIT 1
`);

const stmtRecordPublishedWin = db.prepare<[
  string, string, string, number, number, number | null, string, string, number
]>(`
  INSERT INTO published_wins
    (event_id, user_address, game_address, buy_in_native, payout_native,
     multiplier, tweet_id, tweet_text, published_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function isWinPublished(eventId: string): boolean {
  return stmtIsWinPublished.get(eventId) !== undefined;
}

export function recordPublishedWin(
  win: WinEvent,
  tweetId: string,
  tweetText: string,
): void {
  stmtRecordPublishedWin.run(
    win.eventId,
    win.userAddress,
    win.gameAddress,
    win.buyInNative,
    win.payoutNative,
    win.multiplier,
    tweetId,
    tweetText,
    Math.floor(Date.now() / 1000),
  );
}

// --- cursors ---------------------------------------------------------------

const stmtGetCursor = db.prepare<[string], { value: string }>(`
  SELECT value FROM cursors WHERE key = ?
`);

const stmtSetCursor = db.prepare<[string, string, number]>(`
  INSERT INTO cursors (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

export function getCursor(key: string): string | null {
  const row = stmtGetCursor.get(key);
  return row?.value ?? null;
}

export function setCursor(key: string, value: string): void {
  stmtSetCursor.run(key, value, Math.floor(Date.now() / 1000));
}
