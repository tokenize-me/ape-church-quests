import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';
import {
  WINS_DECIMALS,
  WINS_MIN_MULTIPLIER_PAYOUT,
  WINS_MIN_PAYOUT_NATIVE,
  WINS_POLL_BATCH_SIZE,
} from '../config';
import type { WinEvent } from './types';

// Pre-filter applied to Supabase queries: any candidate that *could* qualify
// under EITHER path must have payout >= the lower of the two payout floors.
// Eliminates ~99% of plays at the DB level so the bot's 200-row poll budget
// has months of headroom even at 50k+ plays/day.
const MIN_CANDIDATE_PAYOUT_NATIVE = Math.min(
  WINS_MIN_PAYOUT_NATIVE,
  WINS_MIN_MULTIPLIER_PAYOUT,
);
export const MIN_CANDIDATE_PAYOUT_WEI = (
  BigInt(MIN_CANDIDATE_PAYOUT_NATIVE) * BigInt(10) ** BigInt(WINS_DECIMALS)
).toString();

interface GameRow {
  event_id: string;
  game_id: string;
  game_address: string;
  user_address: string;
  buy_in_wei: string | number;
  payout_wei: string | number;
  profit_wei: string | number;
  block_timestamp: string;
}

interface UserRow {
  user_address: string;
  username: string | null;
  x_handle: string | null;
}

export function makeSupabaseClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // supabase-js eagerly constructs a RealtimeClient even when we only use REST.
    // On Node < 22 (no native WebSocket), pass `ws` as the realtime transport so
    // construction doesn't throw at startup.
    realtime: { transport: WebSocket as unknown as never },
  });
}

export async function fetchRecentWins(
  supabase: SupabaseClient,
  limit: number = WINS_POLL_BATCH_SIZE,
): Promise<WinEvent[]> {
  const { data: games, error: gameErr } = await supabase
    .from('game_ended_events')
    .select('event_id, game_id, game_address, user_address, buy_in_wei, payout_wei, profit_wei, block_timestamp')
    .gte('payout_wei', MIN_CANDIDATE_PAYOUT_WEI)
    .order('block_timestamp', { ascending: false })
    .limit(limit);

  if (gameErr) throw new Error(`game_ended_events query failed: ${gameErr.message}`);
  return attachUsers(supabase, (games ?? []) as GameRow[]);
}

// Every candidate win with block_timestamp in [sinceUnix, untilUnix), oldest
// first. Pages through the whole window — used by the backfill script, where
// the window can hold more rows than the live poller's batch size.
export async function fetchWinsBetween(
  supabase: SupabaseClient,
  sinceUnix: number,
  untilUnix: number,
): Promise<WinEvent[]> {
  const PAGE_SIZE = 1000;
  const games: GameRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('game_ended_events')
      .select('event_id, game_id, game_address, user_address, buy_in_wei, payout_wei, profit_wei, block_timestamp')
      .gte('payout_wei', MIN_CANDIDATE_PAYOUT_WEI)
      .gte('block_timestamp', new Date(sinceUnix * 1000).toISOString())
      .lt('block_timestamp', new Date(untilUnix * 1000).toISOString())
      .order('block_timestamp', { ascending: true })
      .order('event_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`game_ended_events query failed: ${error.message}`);
    games.push(...((data ?? []) as GameRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return attachUsers(supabase, games);
}

async function attachUsers(
  supabase: SupabaseClient,
  games: GameRow[],
): Promise<WinEvent[]> {
  if (games.length === 0) return [];

  // Chunked so the IN (...) list stays well under PostgREST's URL length limit.
  const USER_CHUNK = 100;
  const userAddresses = Array.from(new Set(games.map((g) => g.user_address)));
  const userByAddress = new Map<string, UserRow>();
  for (let i = 0; i < userAddresses.length; i += USER_CHUNK) {
    const { data: users, error: userErr } = await supabase
      .from('users')
      .select('user_address, username, x_handle')
      .in('user_address', userAddresses.slice(i, i + USER_CHUNK));

    if (userErr) throw new Error(`users query failed: ${userErr.message}`);
    for (const u of users ?? []) {
      userByAddress.set(u.user_address, u);
    }
  }

  return games.map((g) => {
    const user = userByAddress.get(g.user_address);
    const buyInNative = weiToNative(g.buy_in_wei);
    const payoutNative = weiToNative(g.payout_wei);
    const profitNative = weiToNative(g.profit_wei);
    return {
      eventId: g.event_id,
      replayId: String(g.game_id),
      gameAddress: g.game_address.toLowerCase(),
      userAddress: g.user_address.toLowerCase(),
      buyInNative,
      payoutNative,
      profitNative,
      multiplier: buyInNative > 0 ? payoutNative / buyInNative : null,
      blockTimestamp: Math.floor(Date.parse(g.block_timestamp) / 1000),
      username: user?.username ?? null,
      xHandle: user?.x_handle ?? null,
    };
  });
}

function weiToNative(raw: string | number): number {
  return Number(raw) / 10 ** WINS_DECIMALS;
}
