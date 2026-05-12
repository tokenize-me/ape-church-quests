import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectImagesToShow } from './selector';
import { downloadImages, normalizeUrl } from './downloader';
import type { SweepDetected } from '../aggregator/types';

function makeSweep(
  nfts: Array<{ imageUrl: string | null; priceNative?: number }>,
): SweepDetected {
  return {
    chain: 'ethereum',
    txHash: '0xtx',
    collectionSlug: 'cool',
    collectionName: 'Cool',
    currency: 'ETH',
    decimals: 18,
    nfts: nfts.map((n, i) => ({
      nftId: `a/${i}`,
      tokenId: String(i),
      imageUrl: n.imageUrl,
      priceNative: n.priceNative ?? 1,
    })),
    totalNative: nfts.length,
    averageNative: 1,
    timestamp: 1000,
  };
}

describe('selectImagesToShow', () => {
  it('returns all non-null URLs in input order', () => {
    const urls = selectImagesToShow(
      makeSweep([
        { imageUrl: 'a' },
        { imageUrl: 'b' },
        { imageUrl: 'c' },
      ]),
    );
    expect(urls).toEqual(['a', 'b', 'c']);
  });

  it('skips entries with null imageUrl', () => {
    const urls = selectImagesToShow(
      makeSweep([
        { imageUrl: 'a' },
        { imageUrl: null },
        { imageUrl: 'c' },
      ]),
    );
    expect(urls).toEqual(['a', 'c']);
  });

  it('truncates to MAX_COLLAGE_IMAGES (25)', () => {
    const nfts = Array.from({ length: 40 }, (_, i) => ({
      imageUrl: `url-${i}`,
    }));
    expect(selectImagesToShow(makeSweep(nfts))).toHaveLength(25);
  });

  it('returns an empty array when no nfts have images', () => {
    expect(
      selectImagesToShow(
        makeSweep([{ imageUrl: null }, { imageUrl: null }]),
      ),
    ).toEqual([]);
  });
});

describe('normalizeUrl', () => {
  it('rewrites ipfs:// to ipfs.io gateway', () => {
    expect(normalizeUrl('ipfs://bafy123/4.png')).toBe(
      'https://ipfs.io/ipfs/bafy123/4.png',
    );
  });
  it('passes https through unchanged', () => {
    expect(normalizeUrl('https://i.seadn.io/x.png')).toBe(
      'https://i.seadn.io/x.png',
    );
  });
});

describe('downloadImages', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('fetches in parallel and returns buffers in URL order', async () => {
    const fakeFetch = vi.fn(async (url: string) => {
      return new Response(Buffer.from(`bytes-${url}`), { status: 200 });
    });
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const bufs = await downloadImages(['a', 'b', 'c'], 5000);
    expect(bufs).toHaveLength(3);
    expect(bufs[0]?.toString()).toBe('bytes-a');
    expect(bufs[1]?.toString()).toBe('bytes-b');
    expect(bufs[2]?.toString()).toBe('bytes-c');
    expect(fakeFetch).toHaveBeenCalledTimes(3);
  });

  it('retries once on a failed fetch', async () => {
    let callsForB = 0;
    const fakeFetch = vi.fn(async (url: string) => {
      if (url === 'b') {
        callsForB++;
        if (callsForB === 1) throw new Error('flaky');
      }
      return new Response(Buffer.from(`bytes-${url}`), { status: 200 });
    });
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const bufs = await downloadImages(['a', 'b', 'c'], 5000);
    expect(bufs).toHaveLength(3);
    expect(callsForB).toBe(2);
  });

  it('omits images that fail twice', async () => {
    const fakeFetch = vi.fn(async (url: string) => {
      if (url === 'b') throw new Error('always fails');
      return new Response(Buffer.from(`bytes-${url}`), { status: 200 });
    });
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const bufs = await downloadImages(['a', 'b', 'c'], 5000);
    expect(bufs).toHaveLength(2);
    expect(bufs[0]?.toString()).toBe('bytes-a');
    expect(bufs[1]?.toString()).toBe('bytes-c');
  });

  it('treats non-2xx as a failure', async () => {
    const fakeFetch = vi.fn(async (url: string) => {
      if (url === 'b') return new Response('not found', { status: 404 });
      return new Response(Buffer.from(`bytes-${url}`), { status: 200 });
    });
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const bufs = await downloadImages(['a', 'b'], 5000);
    expect(bufs).toHaveLength(1);
    expect(bufs[0]?.toString()).toBe('bytes-a');
  });

  it('rejects oversized responses via content-length header', async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(Buffer.from('small'), {
        status: 200,
        headers: { 'content-length': String(100 * 1024 * 1024) },
      });
    });
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const bufs = await downloadImages(['a'], 5000);
    expect(bufs).toHaveLength(0);
  });

  it('aborts and skips on per-image timeout', async () => {
    const fakeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      // Simulate a hanging request that respects abort
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const start = Date.now();
    const bufs = await downloadImages(['a'], 50);
    expect(Date.now() - start).toBeLessThan(500);
    expect(bufs).toHaveLength(0);
  });

  it('returns an empty array when given no URLs', async () => {
    const bufs = await downloadImages([], 5000);
    expect(bufs).toEqual([]);
  });
});
