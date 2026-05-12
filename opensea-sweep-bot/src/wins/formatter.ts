import {
  GAME_NAMES,
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

  const text = WIN_TWEET_TEMPLATE
    .replace('{playerDisplay}', playerDisplay)
    .replaceAll('{currency}', WINS_CURRENCY)
    .replace('{payout}', formatNative(event.payoutNative, WINS_CURRENCY))
    .replace('{gameName}', gameName)
    .replace('{buyIn}', formatNative(event.buyInNative, WINS_CURRENCY))
    .replace('{multiplier}', multiplierStr);
  return { text };
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
