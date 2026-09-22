import path from 'path';
import { config as loadDotenv } from 'dotenv';

const REPO_ROOT_ENV = path.resolve(__dirname, '..', '..', '.env');
loadDotenv({ path: REPO_ROOT_ENV });

import {
  DRY_RUN,
  QUIET_PERIOD_MS,
  WINS_LISTENER_ENABLED,
  WINS_POLLER_ENABLED,
} from './config';
import { StreamClient } from './stream/client';
import { StreamManager } from './stream/manager';
import { SweepBuffer } from './aggregator/buffer';
import { TwitterPublisher, makeRealTwitterClient } from './publisher/twitter';
import { isSweepPublished, recordPublishedSweep } from './storage/queries';
import { buildSweepMedia, buildSweepText } from './sweeps/compose';
import { WinsBroadcaster } from './wins/broadcaster';
import { WinsListener } from './wins/listener';
import { makeSupabaseClient } from './wins/source';
import type { SweepDetected } from './aggregator/types';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set. Add it to ${REPO_ROOT_ENV}.`);
    process.exit(1);
  }
  return v;
}

async function processSweep(
  sweep: SweepDetected,
  publisher: TwitterPublisher,
  openseaApiKey: string,
): Promise<void> {
  if (isSweepPublished(sweep.chain, sweep.txHash)) {
    console.log(
      `[index] sweep already published, skipping ${sweep.chain}:${sweep.txHash}`,
    );
    return;
  }

  console.log(
    `[index] processing sweep ${sweep.collectionName} ` +
      `nfts=${sweep.nfts.length} total=${sweep.totalNative} ${sweep.currency} ` +
      `chain=${sweep.chain} tx=${sweep.txHash}`,
  );

  const text = await buildSweepText(sweep, openseaApiKey);
  const mediaBuffers = await buildSweepMedia(sweep);

  try {
    const result = await publisher.publishSweep(text, mediaBuffers);
    console.log(
      `[index] published tweetId=${result.tweetId} uploaded=${result.uploadedMediaCount} skipped=${result.skippedMediaCount}`,
    );
    if (!DRY_RUN) {
      try {
        recordPublishedSweep(sweep, result.tweetId, text);
      } catch (err) {
        console.error('[index] recordPublishedSweep failed AFTER post (manual cleanup may be needed)', err);
      }
    }
  } catch (err) {
    console.error('[index] publish failed, not retrying (per spec)', err);
  }
}

async function main(): Promise<void> {
  const openseaKey = requireEnv('OPENSEA_API_KEY');
  const twitterCreds = {
    apiKey: requireEnv('TWITTER_API_KEY'),
    apiSecret: requireEnv('TWITTER_API_SECRET'),
    accessToken: requireEnv('TWITTER_ACCESS_TOKEN'),
    accessTokenSecret: requireEnv('TWITTER_ACCESS_TOKEN_SECRET'),
  };
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseKey = requireEnv('SUPABASE_SERVICE_KEY');

  console.log(
    `opensea-sweep-bot starting (env=${REPO_ROOT_ENV}, dryRun=${DRY_RUN})`,
  );

  const publisher = new TwitterPublisher({
    client: makeRealTwitterClient(twitterCreds),
    dryRun: DRY_RUN,
  });

  const buffer = new SweepBuffer(QUIET_PERIOD_MS, async (sweep) => {
    await processSweep(sweep, publisher, openseaKey);
  });

  const manager = new StreamManager({
    logOnly: false,
    onRelevantSale: (event) => buffer.addEvent(event),
  });
  manager.startHeartbeat();

  const client = new StreamClient({
    apiKey: openseaKey,
    onParsed: (result) => manager.handle(result),
  });
  client.connect();

  const supabase = makeSupabaseClient(supabaseUrl, supabaseKey);
  const wins = new WinsBroadcaster({ supabase, publisher });
  if (WINS_POLLER_ENABLED) {
    console.log('[index] wins poller ENABLED');
    wins.start();
  } else {
    console.log('[index] wins poller DISABLED (listener is the source of truth)');
  }

  let listener: WinsListener | null = null;
  if (WINS_LISTENER_ENABLED) {
    const wssUrl = requireEnv('APECHAIN_WSS_URL');
    listener = new WinsListener({ wssUrl, supabase, broadcaster: wins });
    try {
      await listener.start();
    } catch (err) {
      console.error('[index] listener.start() failed', err);
      throw err;
    }
  } else {
    console.log('[index] wins listener DISABLED');
  }

  let shuttingDown = false;
  const shutdown = async (sig: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[index] received ${sig}, draining buffer (up to 5s)...`);
    manager.stopHeartbeat();
    client.disconnect();
    wins.stop();
    listener?.stop();
    const drain = buffer.flushAll();
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    await Promise.race([drain, timeout]);
    console.log('[index] shutdown complete');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
