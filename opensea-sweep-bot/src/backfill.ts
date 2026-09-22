// One-off backfill: posts the sweep + big-win tweets that never went out
// (e.g. while the X account was out of API credits).
//
// Runs anywhere the shared root .env is available (local machine or droplet).
// It does NOT read the droplet's sweeps.db — sweeps come from OpenSea's REST
// events API and wins from Supabase, so pick a window that starts after the
// last tweet that DID go out. Everything posted is recorded in
// data/backfill-ledger.json, so a re-run (e.g. after a mid-run failure)
// resumes instead of double-posting.
//
//   npm run build
//   node dist/backfill.js --since 2026-09-20T00:00:00Z             # preview only
//   node dist/backfill.js --since 2026-09-20T00:00:00Z --post      # actually tweet
//
// Options:
//   --since <ISO|unix>     start of the window (required)
//   --until <ISO|unix>     end of the window (default: now)
//   --only sweeps|wins     restrict to one kind
//   --skip <id,id,...>     tx hashes / win event ids to leave out
//   --delay <seconds>      pause between tweets when posting (default 30)
//   --post                 post for real; without it nothing is tweeted

import fs from 'fs';
import path from 'path';
import { config as loadDotenv } from 'dotenv';

const REPO_ROOT_ENV = path.resolve(__dirname, '..', '..', '.env');
loadDotenv({ path: REPO_ROOT_ENV });

import { DEPLOYER_ADDRESS, DRY_RUN, isWinTweetExcluded } from './config';
import { buildSweep } from './aggregator/buffer';
import { fetchPurchases } from './opensea/events';
import { TwitterPublisher, makeRealTwitterClient } from './publisher/twitter';
import { buildSweepMedia, buildSweepText } from './sweeps/compose';
import { buildWinTweet } from './wins/formatter';
import { isBigWin } from './wins/selector';
import { fetchWinsBetween, makeSupabaseClient } from './wins/source';
import { warmPnlCard } from './wins/warmup';
import type { SaleEvent, SweepDetected } from './aggregator/types';
import type { WinEvent } from './wins/types';

const LEDGER_PATH = path.resolve(__dirname, '..', 'data', 'backfill-ledger.json');

type Item =
  | { kind: 'sweep'; key: string; timestamp: number; text: string; sweep: SweepDetected }
  | { kind: 'win'; key: string; timestamp: number; text: string; win: WinEvent };

interface Args {
  since: number;
  until: number;
  only: 'sweeps' | 'wins' | null;
  skip: Set<string>;
  delaySec: number;
  post: boolean;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set. Add it to ${REPO_ROOT_ENV}.`);
    process.exit(1);
  }
  return v;
}

function parseTime(raw: string, flag: string): number {
  const ms = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw);
  if (!Number.isFinite(ms)) {
    console.error(`${flag}: can't parse "${raw}" (use ISO like 2026-09-20T00:00:00Z or unix seconds)`);
    process.exit(1);
  }
  return Math.floor(ms / 1000);
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const sinceRaw = get('--since');
  if (!sinceRaw) {
    console.error('--since is required, e.g. --since 2026-09-20T00:00:00Z');
    process.exit(1);
  }
  const untilRaw = get('--until');
  const only = get('--only');
  if (only && only !== 'sweeps' && only !== 'wins') {
    console.error('--only must be "sweeps" or "wins"');
    process.exit(1);
  }
  const delaySec = Number(get('--delay') ?? 30);
  if (!Number.isFinite(delaySec) || delaySec < 0) {
    console.error('--delay must be a non-negative number of seconds');
    process.exit(1);
  }
  const args: Args = {
    since: parseTime(sinceRaw, '--since'),
    until: untilRaw ? parseTime(untilRaw, '--until') : Math.floor(Date.now() / 1000),
    only: (only as Args['only']) ?? null,
    skip: new Set(
      (get('--skip') ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
    delaySec,
    post: argv.includes('--post'),
  };
  if (args.since >= args.until) {
    console.error('--since must be before --until');
    process.exit(1);
  }
  return args;
}

type Ledger = Record<string, Record<string, unknown>>;

function loadLedger(): Ledger {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')) as Ledger;
  } catch {
    return {};
  }
}

function saveLedger(ledger: Ledger): void {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
}

async function collectSweeps(args: Args, openseaKey: string): Promise<Item[]> {
  const purchases = await fetchPurchases(DEPLOYER_ADDRESS, args.since, args.until, openseaKey);

  // Same grouping the live SweepBuffer does: one sweep per (chain, tx).
  const byTx = new Map<string, SaleEvent[]>();
  for (const p of purchases) {
    const key = `${p.chain}:${p.txHash}`;
    byTx.set(key, [...(byTx.get(key) ?? []), p]);
  }

  const items: Item[] = [];
  for (const [txKey, events] of byTx) {
    const sweep = buildSweep(events);
    if (!sweep) continue;
    items.push({
      kind: 'sweep',
      key: `sweep:${txKey}`,
      timestamp: sweep.timestamp,
      text: await buildSweepText(sweep, openseaKey),
      sweep,
    });
  }
  return items;
}

async function collectWins(args: Args): Promise<Item[]> {
  const supabase = makeSupabaseClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_KEY'));
  const wins = await fetchWinsBetween(supabase, args.since, args.until);
  return wins
    .filter((w) => !isWinTweetExcluded(w.gameAddress) && isBigWin(w))
    .map((win) => ({
      kind: 'win' as const,
      key: `win:${win.eventId}`,
      timestamp: win.blockTimestamp,
      text: buildWinTweet(win).text,
      win,
    }));
}

function isSkipped(item: Item, skip: Set<string>): boolean {
  const id = item.kind === 'sweep' ? item.sweep.txHash : item.win.eventId;
  return skip.has(id.toLowerCase());
}

function ledgerEntry(item: Item, tweetId: string): Record<string, unknown> {
  const base = { tweetId, text: item.text, postedAt: new Date().toISOString() };
  if (item.kind === 'sweep') {
    const s = item.sweep;
    return {
      ...base,
      chain: s.chain,
      txHash: s.txHash,
      collectionSlug: s.collectionSlug,
      collectionName: s.collectionName,
      nftCount: s.nfts.length,
      totalNative: s.totalNative,
      currency: s.currency,
      nfts: s.nfts,
    };
  }
  const w = item.win;
  return {
    ...base,
    eventId: w.eventId,
    userAddress: w.userAddress,
    gameAddress: w.gameAddress,
    buyInNative: w.buyInNative,
    payoutNative: w.payoutNative,
    multiplier: w.multiplier,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const openseaKey = requireEnv('OPENSEA_API_KEY');
  const ledger = loadLedger();

  console.log(
    `[backfill] window ${new Date(args.since * 1000).toISOString()} → ${new Date(args.until * 1000).toISOString()}` +
      (args.only ? ` (only ${args.only})` : ''),
  );

  const items = [
    ...(args.only === 'wins' ? [] : await collectSweeps(args, openseaKey)),
    ...(args.only === 'sweeps' ? [] : await collectWins(args)),
  ].sort((a, b) => a.timestamp - b.timestamp);

  const alreadyPosted = items.filter((i) => ledger[i.key]);
  const skipped = items.filter((i) => !ledger[i.key] && isSkipped(i, args.skip));
  const todo = items.filter((i) => !ledger[i.key] && !isSkipped(i, args.skip));

  console.log(
    `\n[backfill] found ${items.length} tweet(s): ${todo.length} to post, ` +
      `${alreadyPosted.length} already in ledger, ${skipped.length} skipped via --skip\n`,
  );
  todo.forEach((item, i) => {
    const when = new Date(item.timestamp * 1000).toISOString();
    const id = item.kind === 'sweep' ? `${item.sweep.chain} tx=${item.sweep.txHash}` : `event=${item.win.eventId}`;
    const extra = item.kind === 'sweep' ? ` nfts=${item.sweep.nfts.length}` : '';
    console.log(`#${i + 1} [${item.kind}] ${when} ${id}${extra}`);
    console.log(`   ${item.text.replace(/\n/g, '\n   ')}\n`);
  });

  if (todo.length === 0) return;
  if (!args.post) {
    console.log('[backfill] preview only — nothing posted. Re-run with --post to tweet these.');
    return;
  }
  if (DRY_RUN) {
    console.log('[backfill] DRY_RUN=true in .env — the publisher will log instead of tweeting.');
  }

  const publisher = new TwitterPublisher({
    client: makeRealTwitterClient({
      apiKey: requireEnv('TWITTER_API_KEY'),
      apiSecret: requireEnv('TWITTER_API_SECRET'),
      accessToken: requireEnv('TWITTER_ACCESS_TOKEN'),
      accessTokenSecret: requireEnv('TWITTER_ACCESS_TOKEN_SECRET'),
    }),
    dryRun: DRY_RUN,
  });

  for (const [i, item] of todo.entries()) {
    if (i > 0 && args.delaySec > 0) await sleep(args.delaySec * 1000);
    try {
      let media: Buffer[] = [];
      if (item.kind === 'sweep') media = await buildSweepMedia(item.sweep);
      else await warmPnlCard(item.win);

      const result = await publisher.publishSweep(item.text, media);
      console.log(`[backfill] ${i + 1}/${todo.length} posted ${item.key} tweetId=${result.tweetId}`);
      if (!DRY_RUN) {
        ledger[item.key] = ledgerEntry(item, result.tweetId);
        saveLedger(ledger);
      }
    } catch (err) {
      // Most likely out of credits / rate limited again — stop rather than
      // burn through the rest. The ledger lets a re-run pick up from here.
      console.error(`[backfill] failed on ${item.key}; stopping with ${todo.length - i} left`, err);
      process.exit(1);
    }
  }
  console.log(`[backfill] done — ledger at ${LEDGER_PATH}`);
}

main().catch((err) => {
  console.error('[backfill] fatal', err);
  process.exit(1);
});
