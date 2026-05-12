import type { ParseFailureReason, ParseResult, ParsedSaleEvent } from './parser';
import type { SaleEvent } from '../aggregator/types';
import {
  ACCEPTED_CHAINS,
  type AcceptedChain,
  DEPLOYER_ADDRESS,
} from '../config';
import { isEventProcessed, markEventProcessed } from '../storage/queries';

export type FilterOutcome =
  | { decision: 'forward'; event: SaleEvent }
  | { decision: 'drop'; reason: 'chain' | 'buyer' | 'duplicate'; chain: string };

export interface FilterDeps {
  isEventProcessed: (chain: string, txHash: string, nftId: string) => boolean;
  markEventProcessed: (event: SaleEvent) => void;
  deployerAddress: string;
  acceptedChains: ReadonlyArray<string>;
}

export function applyFilters(
  parsed: ParsedSaleEvent,
  deps: FilterDeps,
): FilterOutcome {
  if (!deps.acceptedChains.includes(parsed.chain)) {
    return { decision: 'drop', reason: 'chain', chain: parsed.chain };
  }

  if (parsed.buyer !== deps.deployerAddress.toLowerCase()) {
    return { decision: 'drop', reason: 'buyer', chain: parsed.chain };
  }

  if (deps.isEventProcessed(parsed.chain, parsed.txHash, parsed.nftId)) {
    return { decision: 'drop', reason: 'duplicate', chain: parsed.chain };
  }

  const event: SaleEvent = {
    ...parsed,
    chain: parsed.chain as AcceptedChain,
  };
  deps.markEventProcessed(event);

  return { decision: 'forward', event };
}

export type OnRelevantSale = (event: SaleEvent) => void;

interface ManagerOptions {
  onRelevantSale: OnRelevantSale;
  logOnly: boolean;
}

interface Stats {
  received: number;
  matched: number;
  byChain: Record<string, number>;
  parseFailures: Record<string, number>;
}

function makeStats(): Stats {
  return { received: 0, matched: 0, byChain: {}, parseFailures: {} };
}

export class StreamManager {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private stats = makeStats();
  private readonly unknownChainsSeen = new Set<string>();

  constructor(private readonly opts: ManagerOptions) {}

  handle(result: ParseResult): void {
    this.stats.received++;

    if (!result.ok) {
      const key = `${result.reason}${result.chain ? `@${result.chain}` : ''}`;
      this.stats.parseFailures[key] = (this.stats.parseFailures[key] ?? 0) + 1;
      return;
    }

    const parsed = result.event;
    this.stats.byChain[parsed.chain] = (this.stats.byChain[parsed.chain] ?? 0) + 1;

    if (!ACCEPTED_CHAINS.includes(parsed.chain as AcceptedChain)) {
      if (!this.unknownChainsSeen.has(parsed.chain)) {
        this.unknownChainsSeen.add(parsed.chain);
        console.log(`[stream] first event for chain="${parsed.chain}"`);
      }
    }

    const outcome = applyFilters(parsed, {
      isEventProcessed,
      markEventProcessed,
      deployerAddress: DEPLOYER_ADDRESS,
      acceptedChains: ACCEPTED_CHAINS,
    });

    if (outcome.decision === 'drop') return;

    this.stats.matched++;
    console.log(
      `[stream] DEPLOYER BUY chain=${outcome.event.chain} tx=${outcome.event.txHash} ` +
        `collection=${outcome.event.collectionSlug} token=${outcome.event.tokenId} ` +
        `price=${outcome.event.priceNative} ${outcome.event.currency}`,
    );

    if (!this.opts.logOnly) {
      this.opts.onRelevantSale(outcome.event);
    }
  }

  startHeartbeat(intervalMs = 60_000): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const { received, matched, byChain, parseFailures } = this.stats;
      const byChainStr = formatTopEntries(byChain, 6) || '(none)';
      const failuresStr = formatTopEntries(parseFailures, 8) || '(none)';
      console.log(
        `[stream] heartbeat received=${received} deployerMatches=${matched} ` +
          `topChains=[${byChainStr}] parseFailures=[${failuresStr}]`,
      );
      this.stats = makeStats();
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

function formatTopEntries(map: Record<string, number>, take: number): string {
  return Object.entries(map)
    .sort(([, a], [, b]) => b - a)
    .slice(0, take)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

function _exhaustive(_: ParseFailureReason): void {
  /* type-level reminder to keep heartbeat aware of new reasons */
}
