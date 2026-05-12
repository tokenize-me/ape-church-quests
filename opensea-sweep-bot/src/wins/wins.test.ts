import { describe, expect, it } from 'vitest';
import { isBigWin } from './selector';
import { buildWinTweet, derivePlayerDisplay, deriveGameName, truncateAddress } from './formatter';
import type { WinEvent } from './types';

function win(overrides: Partial<WinEvent> = {}): WinEvent {
  return {
    eventId: 'evt-1',
    gameAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    userAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    buyInNative: 50,
    payoutNative: 100,
    profitNative: 50,
    multiplier: 2,
    blockTimestamp: 1_000,
    username: null,
    xHandle: null,
    ...overrides,
  };
}

describe('isBigWin', () => {
  const criteria = {
    minPayoutNative: 1000,
    minPayoutMultiplier: 2,
    minMultiplier: 25,
    minMultiplierPayout: 500,
  };

  // Path A: payout floor + multiplier guard
  it('path A fires when payout >= floor AND multiplier >= 2', () => {
    expect(
      isBigWin(win({ buyInNative: 500, payoutNative: 1500, profitNative: 1000, multiplier: 3 }), criteria),
    ).toBe(true);
  });

  it('path A does NOT fire when payout >= floor but multiplier < 2', () => {
    // bet 50,000 and won 51,500 — 51,500 payout exceeds floor but only 1.03x → excluded
    expect(
      isBigWin(
        win({ buyInNative: 50_000, payoutNative: 51_500, profitNative: 1_500, multiplier: 1.03 }),
        criteria,
      ),
    ).toBe(false);
  });

  it('path A allows a free bet (multiplier=null) when payout floor is met', () => {
    expect(
      isBigWin(win({ buyInNative: 0, payoutNative: 2000, profitNative: 2000, multiplier: null }), criteria),
    ).toBe(true);
  });

  it('path A rejects a free bet when payout below floor', () => {
    expect(
      isBigWin(win({ buyInNative: 0, payoutNative: 500, profitNative: 500, multiplier: null }), criteria),
    ).toBe(false);
  });

  // Path B: multiplier floor + payout guard
  it('path B fires when multiplier >= floor AND payout >= payout floor', () => {
    expect(
      isBigWin(win({ buyInNative: 20, payoutNative: 600, profitNative: 580, multiplier: 30 }), criteria),
    ).toBe(true);
  });

  it('path B does NOT fire when multiplier >= floor but payout < payout floor', () => {
    expect(
      isBigWin(win({ buyInNative: 1, payoutNative: 100, profitNative: 99, multiplier: 100 }), criteria),
    ).toBe(false);
  });

  it('path B does NOT fire when payout big but multiplier below floor', () => {
    expect(
      isBigWin(win({ buyInNative: 200, payoutNative: 800, profitNative: 600, multiplier: 4 }), criteria),
    ).toBe(false);
  });

  // Combined
  it('does not fire when both paths fail', () => {
    expect(
      isBigWin(win({ buyInNative: 50, payoutNative: 100, profitNative: 50, multiplier: 2 }), criteria),
    ).toBe(false);
  });

  // Regression for a "passed directly to .filter()" footgun:
  // .filter invokes the callback with (element, index, array). If isBigWin's
  // optional `criteria` parameter accepts a number from `index`, comparisons
  // against criteria.minPayoutNative (undefined) all return false.
  it('survives being passed directly to Array.prototype.filter', () => {
    const events = [
      win({ buyInNative: 50, payoutNative: 5_000, profitNative: 4_950, multiplier: 100 }),
      win({ buyInNative: 10_000, payoutNative: 30_000, profitNative: 20_000, multiplier: 3 }),
      win({ buyInNative: 50, payoutNative: 100, profitNative: 50, multiplier: 2 }),
    ];
    const filtered = events.filter(isBigWin);
    expect(filtered).toHaveLength(2);
  });

  // Defaults from config: payout>=25k AND mult>=2  OR  mult>=50 AND payout>=1000
  it('uses defaults from config when no criteria passed', () => {
    // path A: bet 10k, won 30k (3x) — payout 30k >= 25k, mult 3 >= 2 → qualifies
    expect(
      isBigWin(win({ buyInNative: 10_000, payoutNative: 30_000, profitNative: 20_000, multiplier: 3 })),
    ).toBe(true);
    // path A fails: bet 24k, won 25k (1.04x) — payout >= 25k but only 1.04x
    expect(
      isBigWin(win({ buyInNative: 24_000, payoutNative: 25_000, profitNative: 1_000, multiplier: 1.04 })),
    ).toBe(false);
    // path B: 60x mult on a 50 APE bet → 3000 payout, qualifies
    expect(
      isBigWin(win({ buyInNative: 50, payoutNative: 3000, profitNative: 2950, multiplier: 60 })),
    ).toBe(true);
    // path B fails: 60x mult but only 600 APE payout (tiny bet, no path B)
    expect(
      isBigWin(win({ buyInNative: 10, payoutNative: 600, profitNative: 590, multiplier: 60 })),
    ).toBe(false);
    // boring small win
    expect(isBigWin(win({ profitNative: 50, payoutNative: 100, buyInNative: 50, multiplier: 2 }))).toBe(false);
  });
});

describe('derivePlayerDisplay', () => {
  it('returns @xHandle when present', () => {
    expect(
      derivePlayerDisplay(win({ xHandle: 'apemaster', username: 'fallback', userAddress: '0xabc' })),
    ).toBe('@apemaster');
  });

  it('strips a leading @ from xHandle', () => {
    expect(derivePlayerDisplay(win({ xHandle: '@apemaster' }))).toBe('@apemaster');
    expect(derivePlayerDisplay(win({ xHandle: '@apemaster' }))).not.toContain('@@');
  });

  it('falls back to username when no xHandle', () => {
    expect(derivePlayerDisplay(win({ xHandle: null, username: 'marky' }))).toBe('marky');
  });

  it('falls back to truncated address when neither exists', () => {
    expect(
      derivePlayerDisplay(win({ xHandle: null, username: null, userAddress: '0x0d69b1d26f56dee4449f5ed3998b0380aaa2fe40' })),
    ).toBe('0x0d69…fe40');
  });

  it('treats empty strings as missing', () => {
    expect(derivePlayerDisplay(win({ xHandle: '', username: 'real', userAddress: '0xabc' }))).toBe('real');
    expect(derivePlayerDisplay(win({ xHandle: null, username: '   ', userAddress: '0x0d69b1d26f56dee4449f5ed3998b0380aaa2fe40' }))).toBe('0x0d69…fe40');
  });
});

describe('truncateAddress', () => {
  it('returns short forms as-is', () => {
    expect(truncateAddress('short')).toBe('short');
  });
  it('truncates standard addresses', () => {
    expect(truncateAddress('0x0d69b1d26f56dee4449f5ed3998b0380aaa2fe40')).toBe('0x0d69…fe40');
  });
});

describe('deriveGameName', () => {
  it('falls back when address not in GAME_NAMES', () => {
    expect(deriveGameName('0xunknownunknownunknownunknownunknownunknownXX')).toContain('a game');
  });

  it('looks up known addresses (lowercased input matches lowercased key)', () => {
    expect(deriveGameName('0x9ebb4df257b971582baf096b62ca41de7723f3cb')).toBe(
      'Slots (DinoDough)',
    );
  });

  it('matches even when caller passes a checksummed address', () => {
    expect(deriveGameName('0x9ebb4Df257B971582BAf096b62CA41DE7723F3CB')).toBe(
      'Slots (DinoDough)',
    );
  });
});

describe('GAME_NAMES map hygiene', () => {
  it('every key is fully lowercase (no checksummed addresses)', async () => {
    const { GAME_NAMES } = await import('../config');
    for (const key of Object.keys(GAME_NAMES)) {
      expect(key, `GAME_NAMES key "${key}" must be lowercase`).toBe(
        key.toLowerCase(),
      );
    }
  });
});

describe('buildWinTweet', () => {
  it('prefixes the tweet with "BIG WIN ALERT!" on its own line', () => {
    const text = buildWinTweet(
      win({ xHandle: 'apemaster', buyInNative: 50, payoutNative: 2500, multiplier: 50 }),
    ).text;
    const lines = text.split('\n');
    expect(lines[0]).toBe('BIG WIN ALERT!');
    expect(lines[1]).toMatch(/^@apemaster/);
  });

  it('renders an X-handle tweet correctly', () => {
    const text = buildWinTweet(
      win({
        xHandle: 'apemaster',
        buyInNative: 50,
        payoutNative: 2500,
        profitNative: 2450,
        multiplier: 50,
        gameAddress: '0xunknownunknownunknownunknownunknownunknownXX',
      }),
    ).text;
    expect(text).toContain('@apemaster');
    expect(text).toContain('2,500.00 APE');
    expect(text).toContain('50.00 APE');
    expect(text).toContain('(50.0x)');
  });

  it('renders a username tweet correctly', () => {
    const text = buildWinTweet(
      win({
        xHandle: null,
        username: 'marky',
        buyInNative: 100,
        payoutNative: 10000,
        profitNative: 9900,
        multiplier: 100,
      }),
    ).text;
    expect(text).toContain('marky');
    expect(text).not.toContain('@marky');
    expect(text).toContain('(100x)');
  });

  it('renders a truncated-address tweet correctly', () => {
    const text = buildWinTweet(
      win({
        xHandle: null,
        username: null,
        userAddress: '0x0d69b1d26f56dee4449f5ed3998b0380aaa2fe40',
        buyInNative: 0,
        payoutNative: 1500,
        profitNative: 1500,
        multiplier: null,
      }),
    ).text;
    expect(text).toContain('0x0d69…fe40');
    expect(text).toContain('∞');
    expect(text).toContain('0.00 APE');
  });
});
