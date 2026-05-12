import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SweepBuffer, buildSweep } from './buffer';
import type { SaleEvent, SweepDetected } from './types';

const QUIET = 15_000;

function makeEvent(overrides: Partial<SaleEvent> = {}): SaleEvent {
  return {
    chain: 'ethereum',
    txHash: '0xtx1',
    nftId: 'ethereum/0xnft/1',
    orderHash: '0xorder1',
    buyer: '0xbuyer',
    seller: '0xseller',
    collectionSlug: 'cool',
    collectionName: 'Cool',
    tokenId: '1',
    contractAddress: '0xnft',
    imageUrl: null,
    priceNative: 0.5,
    currency: 'ETH',
    decimals: 18,
    timestamp: 1_000,
    ...overrides,
  };
}

describe('SweepBuffer', () => {
  let sweeps: SweepDetected[];
  let buf: SweepBuffer;

  beforeEach(() => {
    vi.useFakeTimers();
    sweeps = [];
    buf = new SweepBuffer(QUIET, async (s) => {
      sweeps.push(s);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('flushes a single event after the quiet period', async () => {
    buf.addEvent(makeEvent());
    expect(sweeps).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(QUIET - 1);
    expect(sweeps).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]?.nfts).toHaveLength(1);
    expect(sweeps[0]?.totalNative).toBe(0.5);
  });

  it('groups multiple events with the same tx into one flush', async () => {
    buf.addEvent(makeEvent({ nftId: 'a/1', tokenId: '1', priceNative: 0.5 }));
    buf.addEvent(makeEvent({ nftId: 'a/2', tokenId: '2', priceNative: 0.25 }));
    buf.addEvent(makeEvent({ nftId: 'a/3', tokenId: '3', priceNative: 1.0 }));

    await vi.advanceTimersByTimeAsync(QUIET);

    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]?.nfts).toHaveLength(3);
    expect(sweeps[0]?.totalNative).toBeCloseTo(1.75, 10);
    expect(sweeps[0]?.averageNative).toBeCloseTo(1.75 / 3, 10);
  });

  it('handles different transactions as independent flushes', async () => {
    buf.addEvent(makeEvent({ txHash: '0xA', nftId: 'a/1' }));
    buf.addEvent(makeEvent({ txHash: '0xB', nftId: 'b/1' }));

    await vi.advanceTimersByTimeAsync(QUIET);

    expect(sweeps).toHaveLength(2);
    const hashes = sweeps.map((s) => s.txHash).sort();
    expect(hashes).toEqual(['0xA', '0xB']);
  });

  it('resets the timer when a new event arrives mid-window', async () => {
    buf.addEvent(makeEvent({ nftId: 'a/1' }));

    // 10s in — no flush yet
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sweeps).toHaveLength(0);

    // Another event resets the 15s window
    buf.addEvent(makeEvent({ nftId: 'a/2' }));

    // Original window would have fired at 15s; advance to 20s total (5s past original)
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sweeps).toHaveLength(0);

    // Now 15s after the SECOND event (25s total since start)
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]?.nfts).toHaveLength(2);
  });

  it('treats the same tx hash on different chains as separate sweeps', async () => {
    buf.addEvent(makeEvent({ chain: 'ethereum', txHash: '0xSAME', nftId: 'ethereum/x/1' }));
    buf.addEvent(makeEvent({ chain: 'ape_chain', txHash: '0xSAME', nftId: 'ape_chain/x/1', currency: 'APE' }));

    await vi.advanceTimersByTimeAsync(QUIET);

    expect(sweeps).toHaveLength(2);
    const byChain = Object.fromEntries(sweeps.map((s) => [s.chain, s]));
    expect(byChain.ethereum?.currency).toBe('ETH');
    expect(byChain.ape_chain?.currency).toBe('APE');
  });

  it('flushAll drains every pending bucket immediately', async () => {
    buf.addEvent(makeEvent({ txHash: '0xA', nftId: 'a/1' }));
    buf.addEvent(makeEvent({ txHash: '0xB', nftId: 'b/1' }));
    expect(buf.size()).toBe(2);

    await buf.flushAll();

    expect(buf.size()).toBe(0);
    expect(sweeps).toHaveLength(2);
  });

  it('keeps running when the onSweep handler throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const flaky = new SweepBuffer(QUIET, async () => {
      calls++;
      if (calls === 1) throw new Error('first one fails');
    });

    flaky.addEvent(makeEvent({ txHash: '0xA', nftId: 'a/1' }));
    await vi.advanceTimersByTimeAsync(QUIET);
    expect(calls).toBe(1);
    expect(errSpy).toHaveBeenCalled();

    flaky.addEvent(makeEvent({ txHash: '0xB', nftId: 'b/1' }));
    await vi.advanceTimersByTimeAsync(QUIET);
    expect(calls).toBe(2);
  });

  it('skips a sweep when events have mixed currencies', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    buf.addEvent(makeEvent({ nftId: 'a/1', currency: 'ETH' }));
    buf.addEvent(makeEvent({ nftId: 'a/2', currency: 'WETH' }));

    await vi.advanceTimersByTimeAsync(QUIET);

    expect(sweeps).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('mixed-currency'));
  });

  it('warns but proceeds when events span multiple collections (uses first)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    buf.addEvent(makeEvent({ nftId: 'a/1', collectionSlug: 'cool', collectionName: 'Cool' }));
    buf.addEvent(makeEvent({ nftId: 'a/2', collectionSlug: 'rare', collectionName: 'Rare' }));

    await vi.advanceTimersByTimeAsync(QUIET);

    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]?.collectionSlug).toBe('cool');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('multi-collection'));
  });
});

describe('buildSweep', () => {
  it('returns null for an empty event list', () => {
    expect(buildSweep([])).toBeNull();
  });

  it('uses the minimum timestamp across all events', () => {
    const sweep = buildSweep([
      { ...makeBase(), timestamp: 2000 },
      { ...makeBase(), timestamp: 1000, nftId: 'a/2' },
      { ...makeBase(), timestamp: 3000, nftId: 'a/3' },
    ]);
    expect(sweep?.timestamp).toBe(1000);
  });

  it('computes total and average correctly for fractional prices', () => {
    const sweep = buildSweep([
      { ...makeBase(), priceNative: 0.1 },
      { ...makeBase(), priceNative: 0.2, nftId: 'a/2' },
      { ...makeBase(), priceNative: 0.3, nftId: 'a/3' },
    ]);
    expect(sweep?.totalNative).toBeCloseTo(0.6, 10);
    expect(sweep?.averageNative).toBeCloseTo(0.2, 10);
  });
});

function makeBase(): SaleEvent {
  return {
    chain: 'ethereum',
    txHash: '0xtx',
    nftId: 'a/1',
    orderHash: '0xorder',
    buyer: '0xbuyer',
    seller: '0xseller',
    collectionSlug: 'cool',
    collectionName: 'Cool',
    tokenId: '1',
    contractAddress: '0xnft',
    imageUrl: null,
    priceNative: 1,
    currency: 'ETH',
    decimals: 18,
    timestamp: 1000,
  };
}
