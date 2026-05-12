export interface WinEvent {
  eventId: string;
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
