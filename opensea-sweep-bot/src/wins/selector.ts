import {
  WINS_MIN_MULTIPLIER,
  WINS_MIN_MULTIPLIER_PAYOUT,
  WINS_MIN_PROFIT_MULTIPLIER,
  WINS_MIN_PROFIT_NATIVE,
} from '../config';
import type { WinEvent } from './types';

export interface BigWinCriteria {
  /** Path A: profit floor (e.g. 25,000 APE). */
  minProfitNative: number;
  /** Path A: minimum multiplier guard (e.g. 2x). null multiplier (free bet) bypasses this. */
  minProfitMultiplier: number;
  /** Path B: multiplier floor (e.g. 50x). */
  minMultiplier: number;
  /** Path B: payout floor (e.g. 1,000 APE) — keeps tiny-bet flukes out. */
  minMultiplierPayout: number;
}

export const DEFAULT_BIG_WIN_CRITERIA: BigWinCriteria = {
  minProfitNative: WINS_MIN_PROFIT_NATIVE,
  minProfitMultiplier: WINS_MIN_PROFIT_MULTIPLIER,
  minMultiplier: WINS_MIN_MULTIPLIER,
  minMultiplierPayout: WINS_MIN_MULTIPLIER_PAYOUT,
};

export function isBigWin(
  event: WinEvent,
  criteria: BigWinCriteria = DEFAULT_BIG_WIN_CRITERIA,
): boolean {
  // Path A: large absolute profit, gated on meaningful multiplier.
  // A free bet (multiplier === null) bypasses the multiplier guard since "infinite x" trivially passes any threshold.
  if (event.profitNative >= criteria.minProfitNative) {
    if (event.multiplier === null || event.multiplier >= criteria.minProfitMultiplier) {
      return true;
    }
  }

  // Path B: large multiplier, gated on non-trivial payout.
  if (
    event.multiplier !== null &&
    event.multiplier >= criteria.minMultiplier &&
    event.payoutNative >= criteria.minMultiplierPayout
  ) {
    return true;
  }

  return false;
}
