import type { SupabaseClient } from '@supabase/supabase-js';

// Row matching the public.game_ended_events schema.
// `profit_wei` is a GENERATED ALWAYS column — DO NOT include it in the insert.
// `inserted_at` defaults to now() server-side.
export interface GameEndedRow {
  event_id: string;          // `${txHashLowercase}-${logIndexDecimal}` — PK
  game_id: string;           // bigint serialized as string (overflows JS number)
  game_address: string;      // lowercased 0x address
  user_address: string;      // lowercased 0x address
  buy_in_wei: string;        // numeric serialized as string
  payout_wei: string;        // numeric serialized as string
  block_timestamp: string;   // ISO 8601 — Postgres timestamptz accepts this
  raw: unknown;              // jsonb — mirrors the subgraph shape
}

export interface DecodedGameEnded {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockTimestampUnix: number;
  gameAddress: string;
  user: string;
  gameId: bigint;
  buyIn: bigint;
  payout: bigint;
}

// Builds the row payload from a decoded event. Pure — no side effects, easy to
// unit test against the schema in pnl-share-bot.md / the subgraph's existing rows.
export function buildGameEndedRow(decoded: DecodedGameEnded): GameEndedRow {
  const txHash = decoded.txHash.toLowerCase();
  const gameAddress = decoded.gameAddress.toLowerCase();
  const userAddress = decoded.user.toLowerCase();
  const gameIdStr = decoded.gameId.toString();
  const buyInStr = decoded.buyIn.toString();
  const payoutStr = decoded.payout.toString();
  const eventId = `${txHash}-${decoded.logIndex}`;

  return {
    event_id: eventId,
    game_id: gameIdStr,
    game_address: gameAddress,
    user_address: userAddress,
    buy_in_wei: buyInStr,
    payout_wei: payoutStr,
    block_timestamp: new Date(decoded.blockTimestampUnix * 1000).toISOString(),
    // Mirror the subgraph's raw shape so downstream consumers don't need to branch.
    raw: {
      id: eventId,
      game: { id: gameAddress },
      user: { id: userAddress },
      buyIn: buyInStr,
      gameId: gameIdStr,
      payout: payoutStr,
      timestamp: String(decoded.blockTimestampUnix),
    },
  };
}

// Upserts a single row, ignoring duplicates on event_id (PK). Safe to call
// concurrently with the subgraph's writer during cutover — first writer wins,
// subsequent writers noop.
export async function upsertGameEndedRow(
  supabase: SupabaseClient,
  row: GameEndedRow,
): Promise<{ inserted: boolean }> {
  const { error, count } = await supabase
    .from('game_ended_events')
    .upsert(row, { onConflict: 'event_id', ignoreDuplicates: true, count: 'exact' });

  if (error) {
    throw new Error(`game_ended_events upsert failed for ${row.event_id}: ${error.message}`);
  }
  // count === 0 means the row already existed and was skipped.
  return { inserted: (count ?? 0) > 0 };
}
