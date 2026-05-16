import {
  APE_CHURCH_BASE_URL,
  GAME_NAMES,
  GAME_SLUGS,
  WIN_TWEET_TEMPLATE,
  WINS_CURRENCY,
} from '../config';
import { formatNative } from '../formatter/format-helpers';
import type { WinEvent } from './types';

export function buildWinTweet(event: WinEvent): { text: string } {
  const playerDisplay = derivePlayerDisplay(event);
  const gameName = deriveGameName(event.gameAddress);
  const multiplierStr = event.multiplier !== null
    ? formatMultiplier(event.multiplier)
    : '∞';

  const base = WIN_TWEET_TEMPLATE
    .replace('{playerDisplay}', playerDisplay)
    .replaceAll('{currency}', WINS_CURRENCY)
    .replace('{payout}', formatNative(event.payoutNative, WINS_CURRENCY))
    .replace('{gameName}', gameName)
    .replace('{buyIn}', formatNative(event.buyInNative, WINS_CURRENCY))
    .replace('{multiplier}', multiplierStr);

  const replayUrl = deriveReplayUrl(event);
  const text = replayUrl ? `${base}\n${replayUrl}` : base;
  return { text };
}

// Returns the replay URL for the event, or null if we don't have a slug for
// this game (graceful: tweet still posts, just without the link). Also returns
// null if replayId isn't numeric, which should never happen given the source
// query but is cheap to guard against.
export function deriveReplayUrl(event: WinEvent): string | null {
  const slug = GAME_SLUGS[event.gameAddress.toLowerCase()];
  if (!slug) return null;
  if (!/^\d+$/.test(event.replayId)) return null;
  return `${APE_CHURCH_BASE_URL}/games/${slug}?id=${event.replayId}`;
}

export function derivePlayerDisplay(event: WinEvent): string {
  if (event.xHandle && event.xHandle.trim().length > 0) {
    return `@${event.xHandle.trim().replace(/^@/, '')}`;
  }
  if (event.username && event.username.trim().length > 0) {
    return event.username.trim();
  }
  return truncateAddress(event.userAddress);
}

export function deriveGameName(gameAddress: string): string {
  const key = gameAddress.toLowerCase();
  return GAME_NAMES[key] ?? `a game (${truncateAddress(key)})`;
}

export function truncateAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatMultiplier(m: number): string {
  if (m >= 100) return Math.round(m).toLocaleString('en-US');
  if (m >= 10) return m.toFixed(1);
  return m.toFixed(2);
}
