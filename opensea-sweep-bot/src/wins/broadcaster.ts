import type { SupabaseClient } from '@supabase/supabase-js';
import { TwitterPublisher } from '../publisher/twitter';
import { fetchRecentWins } from './source';
import { isBigWin } from './selector';
import { buildWinTweet } from './formatter';
import { isWinPublished, recordPublishedWin } from '../storage/queries';
import { DRY_RUN, WINS_POLL_INTERVAL_MS } from '../config';
import type { WinEvent } from './types';

export interface WinsBroadcasterOptions {
  supabase: SupabaseClient;
  publisher: TwitterPublisher;
  pollIntervalMs?: number;
}

export class WinsBroadcaster {
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private readonly floorTimestamp: number;

  constructor(private readonly opts: WinsBroadcasterOptions) {
    // Only events whose block_timestamp is at-or-after process startup are considered.
    // Prevents a "flood" on first run when published_wins is empty.
    this.floorTimestamp = Math.floor(Date.now() / 1000);
  }

  start(): void {
    if (this.timer) return;
    const interval = this.opts.pollIntervalMs ?? WINS_POLL_INTERVAL_MS;
    console.log(
      `[wins] broadcaster started, polling every ${interval}ms; floor=${new Date(this.floorTimestamp * 1000).toISOString()}`,
    );
    // Fire one poll immediately, then on the interval.
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.polling) {
      console.log('[wins] previous poll still in flight, skipping this tick');
      return;
    }
    this.polling = true;
    try {
      const wins = await fetchRecentWins(this.opts.supabase);
      const bigUnposted = wins.filter(
        (w) =>
          w.blockTimestamp >= this.floorTimestamp &&
          isBigWin(w) &&
          !isWinPublished(w.eventId),
      );
      if (bigUnposted.length === 0) return;

      console.log(
        `[wins] found ${bigUnposted.length} big win(s) to publish out of ${wins.length} polled`,
      );

      // Publish oldest first so timeline order matches chronological order.
      bigUnposted.sort((a, b) => a.blockTimestamp - b.blockTimestamp);

      for (const win of bigUnposted) {
        await this.publishWin(win);
      }
    } catch (err) {
      console.error('[wins] poll failed', err);
    } finally {
      this.polling = false;
    }
  }

  private async publishWin(win: WinEvent): Promise<void> {
    const { text } = buildWinTweet(win);
    console.log(
      `[wins] publishing win event=${win.eventId} user=${win.userAddress} payout=${win.payoutNative} buyIn=${win.buyInNative}`,
    );

    try {
      const result = await this.opts.publisher.publishSweep(text, []);
      console.log(
        `[wins] published tweetId=${result.tweetId} text="${text}"`,
      );
      if (!DRY_RUN) {
        try {
          recordPublishedWin(win, result.tweetId, text);
        } catch (err) {
          console.error(
            '[wins] recordPublishedWin failed AFTER post (may double-tweet on next poll)',
            err,
          );
        }
      }
    } catch (err) {
      console.error('[wins] publish failed, not retrying (per spec)', err);
    }
  }
}
