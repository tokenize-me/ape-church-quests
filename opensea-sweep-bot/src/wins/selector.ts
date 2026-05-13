import {
  WINS_MIN_MULTIPLIER,
  WINS_MIN_MULTIPLIER_PAYOUT,
  WINS_MIN_PAYOUT_MULTIPLIER,
  WINS_MIN_PAYOUT_NATIVE,
} from '../config';
import type { WinEvent } from './types';

export interface BigWinCriteria {
  /** Path A: payout floor (e.g. 15,000 APE gross). */
  minPayoutNative: number;
  /** Path A: minimum multiplier guard (e.g. 1.8x). null multiplier (free bet) bypasses this. */
  minPayoutMultiplier: number;
  /** Path B: multiplier floor (e.g. 25x). */
  minMultiplier: number;
  /** Path B: payout floor (e.g. 1,000 APE) — keeps tiny-bet flukes out. */
  minMultiplierPayout: number;
}

export const DEFAULT_BIG_WIN_CRITERIA: BigWinCriteria = {
  minPayoutNative: WINS_MIN_PAYOUT_NATIVE,
  minPayoutMultiplier: WINS_MIN_PAYOUT_MULTIPLIER,
  minMultiplier: WINS_MIN_MULTIPLIER,
  minMultiplierPayout: WINS_MIN_MULTIPLIER_PAYOUT,
};

export function isBigWin(
  event: WinEvent,
  criteria?: BigWinCriteria,
): boolean {
  // Guard: if called via `arr.filter(isBigWin)`, JS passes (element, index, array)
  // and `index` (a number) would shadow the default. Fall back to defaults unless
  // we actually got a criteria object.
  const c =
    criteria && typeof criteria === 'object'
      ? criteria
      : DEFAULT_BIG_WIN_CRITERIA;

  // Path A: large absolute payout, gated on meaningful multiplier.
  // A free bet (multiplier === null) bypasses the multiplier guard since "infinite x" trivially passes any threshold.
  if (event.payoutNative >= c.minPayoutNative) {
    if (event.multiplier === null || event.multiplier >= c.minPayoutMultiplier) {
      return true;
    }
  }

  // Path B: large multiplier, gated on non-trivial payout.
  if (
    event.multiplier !== null &&
    event.multiplier >= c.minMultiplier &&
    event.payoutNative >= c.minMultiplierPayout
  ) {
    return true;
  }

  return false;
}
