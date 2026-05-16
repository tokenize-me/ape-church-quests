import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createPublicClient,
  webSocket,
  type Log,
} from 'viem';
import { apeChain } from 'viem/chains';
import {
  WINS_BACKFILL_BLOCKS_MAX,
  WINS_DECIMALS,
  WINS_LAST_SEEN_BLOCK_KEY,
  TRACKED_GAME_ADDRESSES,
} from '../config';
import { getCursor, setCursor } from '../storage/queries';
import { GAME_ENDED_ABI } from './abi';
import { buildGameEndedRow, upsertGameEndedRow, type DecodedGameEnded } from './sink';
import { fetchUserProfile } from './profile';
import type { WinsBroadcaster } from './broadcaster';
import type { WinEvent } from './types';

export interface WinsListenerOptions {
  wssUrl: string;
  supabase: SupabaseClient;
  broadcaster: WinsBroadcaster;
}

// Typed alias for the Logs viem hands us once narrowed by GAME_ENDED_ABI.
// `args` is { user, gameId, buyIn, payout } with their correct primitive types.
type GameEndedLog = Log<bigint, number, false, (typeof GAME_ENDED_ABI)[0], true>;

// Typing the client via ReturnType keeps the precise inferred chain/transport
// generics that an explicit `PublicClient` annotation would erase.
type WssClient = ReturnType<typeof makeWssClient>;

function makeWssClient(wssUrl: string) {
  return createPublicClient({
    chain: apeChain,
    transport: webSocket(wssUrl),
  });
}

export class WinsListener {
  private client: WssClient;
  private unwatch: (() => void) | null = null;
  private stopping = false;
  // Per-block timestamp cache so we don't fetch the same block N times when
  // multiple events land in the same block.
  private blockTimestampCache = new Map<string, number>();

  constructor(private readonly opts: WinsListenerOptions) {
    this.client = makeWssClient(opts.wssUrl);
  }

  async start(): Promise<void> {
    console.log(
      `[listener] starting; tracking ${TRACKED_GAME_ADDRESSES.length} game(s)`,
    );

    await this.backfill();

    this.unwatch = this.client.watchContractEvent({
      address: TRACKED_GAME_ADDRESSES,
      abi: GAME_ENDED_ABI,
      eventName: 'GameEnded',
      strict: true,
      onLogs: (logs) => {
        void this.handleLogs(logs as GameEndedLog[], 'live');
      },
      onError: (err) => {
        console.error('[listener] watchContractEvent error', err);
        // viem retries internally; nothing to do here beyond logging.
      },
    });

    console.log('[listener] subscribed to GameEnded');
  }

  stop(): void {
    this.stopping = true;
    if (this.unwatch) {
      try {
        this.unwatch();
      } catch (err) {
        console.error('[listener] unwatch threw', err);
      }
      this.unwatch = null;
    }
  }

  // Catches up on logs emitted while the bot was down. Capped by
  // WINS_BACKFILL_BLOCKS_MAX so a long downtime can't trigger an unbounded
  // eth_getLogs (which Alchemy would reject anyway).
  private async backfill(): Promise<void> {
    const head = await this.client.getBlockNumber();
    const cursorRaw = getCursor(WINS_LAST_SEEN_BLOCK_KEY);
    const lastSeen = cursorRaw ? BigInt(cursorRaw) : null;

    if (lastSeen === null) {
      // First boot: don't backfill — just anchor at head. Prevents a flood
      // of historical "wins" from being processed (same policy as the
      // poller's floorTimestamp).
      console.log(`[listener] no cursor; anchoring at head=${head}`);
      setCursor(WINS_LAST_SEEN_BLOCK_KEY, head.toString());
      return;
    }

    if (lastSeen >= head) {
      console.log(`[listener] cursor (${lastSeen}) already at/past head (${head}); nothing to backfill`);
      return;
    }

    const gap = head - lastSeen;
    const fromBlock =
      gap > BigInt(WINS_BACKFILL_BLOCKS_MAX)
        ? head - BigInt(WINS_BACKFILL_BLOCKS_MAX)
        : lastSeen + 1n;

    if (fromBlock > lastSeen + 1n) {
      console.warn(
        `[listener] backfill gap (${gap} blocks) exceeds cap (${WINS_BACKFILL_BLOCKS_MAX}); ` +
          `skipping ${fromBlock - lastSeen - 1n} blocks of history`,
      );
    }

    console.log(`[listener] backfilling from ${fromBlock} to ${head}`);
    const logs = await this.client.getContractEvents({
      address: TRACKED_GAME_ADDRESSES,
      abi: GAME_ENDED_ABI,
      eventName: 'GameEnded',
      strict: true,
      fromBlock,
      toBlock: head,
    });
    console.log(`[listener] backfill found ${logs.length} log(s)`);
    await this.handleLogs(logs as GameEndedLog[], 'backfill');
  }

  // Single ordered processing pipeline used by both backfill and live paths.
  // Order matters: per-block ascending, then per-logIndex ascending, so the
  // tweet timeline matches chronological order even when batches contain
  // multiple events from the same tx.
  private async handleLogs(logs: GameEndedLog[], origin: 'backfill' | 'live'): Promise<void> {
    if (logs.length === 0) return;
    const sorted = [...logs].sort((a, b) => {
      const blockCmp = Number(a.blockNumber - b.blockNumber);
      if (blockCmp !== 0) return blockCmp;
      return a.logIndex - b.logIndex;
    });

    let maxBlock: bigint = 0n;
    for (const log of sorted) {
      if (this.stopping) return;
      try {
        await this.processLog(log);
      } catch (err) {
        console.error(
          `[listener] processLog failed (origin=${origin}) tx=${log.transactionHash} idx=${log.logIndex}`,
          err,
        );
        // Continue with subsequent logs — one bad row shouldn't block the stream.
      }
      if (log.blockNumber > maxBlock) maxBlock = log.blockNumber;
    }

    // Advance cursor to the highest block we've successfully iterated, so a
    // restart resumes from here. We update after the batch (not per-log) to
    // avoid sqlite write churn on bursty blocks.
    if (maxBlock > 0n) {
      const prev = getCursor(WINS_LAST_SEEN_BLOCK_KEY);
      if (!prev || BigInt(prev) < maxBlock) {
        setCursor(WINS_LAST_SEEN_BLOCK_KEY, maxBlock.toString());
      }
    }
  }

  private async processLog(log: GameEndedLog): Promise<void> {
    const decoded = await this.decode(log);
    const row = buildGameEndedRow(decoded);

    // 1. Source-of-truth write to Supabase. Idempotent — dups noop.
    const { inserted } = await upsertGameEndedRow(this.opts.supabase, row);
    if (inserted) {
      console.log(
        `[listener] upserted ${row.event_id} game=${row.game_address} payout_wei=${row.payout_wei}`,
      );
    }

    // 2. Tweet path: build a WinEvent and hand it to the broadcaster, which
    //    enforces the floor + bigWin + dedup gates and publishes if it qualifies.
    const win = await this.toWinEvent(decoded);
    await this.opts.broadcaster.handleEvent(win);
  }

  private async decode(log: GameEndedLog): Promise<DecodedGameEnded> {
    const ts = await this.getBlockTimestamp(log.blockNumber);
    return {
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      blockTimestampUnix: ts,
      gameAddress: log.address,
      user: log.args.user,
      gameId: log.args.gameId,
      buyIn: log.args.buyIn,
      payout: log.args.payout,
    };
  }

  private async toWinEvent(d: DecodedGameEnded): Promise<WinEvent> {
    const buyInNative = weiToNative(d.buyIn);
    const payoutNative = weiToNative(d.payout);
    const profitNative = payoutNative - buyInNative;
    const profile = await this.lookupProfileSafe(d.user);

    return {
      eventId: `${d.txHash.toLowerCase()}-${d.logIndex}`,
      replayId: d.gameId.toString(),
      gameAddress: d.gameAddress.toLowerCase(),
      userAddress: d.user.toLowerCase(),
      buyInNative,
      payoutNative,
      profitNative,
      multiplier: buyInNative > 0 ? payoutNative / buyInNative : null,
      blockTimestamp: d.blockTimestampUnix,
      username: profile?.username ?? null,
      xHandle: profile?.xHandle ?? null,
    };
  }

  // Profile is a nice-to-have — a failure here shouldn't drop the tweet,
  // since the formatter falls back to a truncated address display.
  private async lookupProfileSafe(address: string) {
    try {
      return await fetchUserProfile(this.opts.supabase, address);
    } catch (err) {
      console.error(`[listener] profile lookup failed for ${address}`, err);
      return null;
    }
  }

  private async getBlockTimestamp(blockNumber: bigint): Promise<number> {
    const key = blockNumber.toString();
    const cached = this.blockTimestampCache.get(key);
    if (cached !== undefined) return cached;
    const block = await this.client.getBlock({ blockNumber });
    const ts = Number(block.timestamp);
    // Bounded cache: keep only the last 200 blocks to cap memory.
    if (this.blockTimestampCache.size >= 200) {
      const firstKey = this.blockTimestampCache.keys().next().value;
      if (firstKey !== undefined) this.blockTimestampCache.delete(firstKey);
    }
    this.blockTimestampCache.set(key, ts);
    return ts;
  }
}

function weiToNative(raw: bigint): number {
  // bigint → number via division. Acceptable: 18-decimal APE values up to
  // ~9e15 native units still fit in a Number; we'd care if a single win
  // exceeded that, which is astronomically unlikely.
  return Number(raw) / 10 ** WINS_DECIMALS;
}
