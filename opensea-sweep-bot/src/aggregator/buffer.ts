import type { SaleEvent, SweepDetected } from './types';

interface Bucket {
  events: SaleEvent[];
  timer: NodeJS.Timeout;
}

export type OnSweepHandler = (sweep: SweepDetected) => Promise<void>;

export class SweepBuffer {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly quietPeriodMs: number,
    private readonly onSweep: OnSweepHandler,
  ) {}

  addEvent(event: SaleEvent): void {
    const key = keyFor(event.chain, event.txHash);
    const existing = this.buckets.get(key);

    if (existing) {
      clearTimeout(existing.timer);
      existing.events.push(event);
      existing.timer = this.scheduleFlush(key);
    } else {
      this.buckets.set(key, {
        events: [event],
        timer: this.scheduleFlush(key),
      });
    }
  }

  async flushAll(): Promise<void> {
    const keys = Array.from(this.buckets.keys());
    await Promise.all(keys.map((k) => this.flush(k)));
  }

  size(): number {
    return this.buckets.size;
  }

  private scheduleFlush(key: string): NodeJS.Timeout {
    return setTimeout(() => {
      void this.flush(key);
    }, this.quietPeriodMs);
  }

  private async flush(key: string): Promise<void> {
    const bucket = this.buckets.get(key);
    if (!bucket) return;
    clearTimeout(bucket.timer);
    this.buckets.delete(key);

    const sweep = buildSweep(bucket.events);
    if (!sweep) return;

    try {
      await this.onSweep(sweep);
    } catch (err) {
      console.error('[buffer] onSweep handler threw, swallowing', err);
    }
  }
}

function keyFor(chain: string, txHash: string): string {
  return `${chain}:${txHash}`;
}

export function buildSweep(events: SaleEvent[]): SweepDetected | null {
  if (events.length === 0) return null;
  const first = events[0]!;

  const currencies = new Set(events.map((e) => e.currency));
  if (currencies.size > 1) {
    console.warn(
      `[buffer] mixed-currency sweep skipped: chain=${first.chain} tx=${first.txHash} currencies=${Array.from(currencies).join(',')}`,
    );
    return null;
  }

  const collections = new Set(events.map((e) => e.collectionSlug));
  if (collections.size > 1) {
    console.warn(
      `[buffer] multi-collection sweep, using first collection: ${first.collectionSlug} (others: ${Array.from(collections).slice(1).join(',')})`,
    );
  }

  const total = events.reduce((s, e) => s + e.priceNative, 0);

  return {
    chain: first.chain,
    txHash: first.txHash,
    collectionSlug: first.collectionSlug,
    collectionName: first.collectionName,
    currency: first.currency,
    decimals: first.decimals,
    nfts: events.map((e) => ({
      nftId: e.nftId,
      tokenId: e.tokenId,
      imageUrl: e.imageUrl,
      priceNative: e.priceNative,
    })),
    totalNative: total,
    averageNative: total / events.length,
    timestamp: Math.min(...events.map((e) => e.timestamp)),
  };
}
