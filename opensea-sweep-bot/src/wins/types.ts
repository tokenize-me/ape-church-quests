export interface WinEvent {
  eventId: string;
  // Numeric on-chain bet id (Supabase `game_ended_events.game_id`). Stored as a
  // string because it's a bigint that overflows JS number precision. Used as
  // the `?id=` query param on the replay URL.
  replayId: string;
  gameAddress: string;
  userAddress: string;
  buyInNative: number;
  payoutNative: number;
  profitNative: number;
  multiplier: number | null; // null when buy_in == 0
  blockTimestamp: number; // unix seconds
  username: string | null;
  xHandle: string | null;
}
