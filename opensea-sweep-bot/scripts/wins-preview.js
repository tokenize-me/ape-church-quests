// Diagnostic preview: what would have qualified in the recent window?
// Run from the bot dir:
//   node scripts/wins-preview.js                 # last 24h by inserted_at
//   node scripts/wins-preview.js 168             # last 168h by inserted_at
//   node scripts/wins-preview.js 24 block        # last 24h by block_timestamp (on-chain time)
//
// Filters by `inserted_at` by default — matches what the live bot actually
// "sees" via polling. Use `block` mode to filter by on-chain timestamp.
//
// Prints row counts, timestamp ranges, top payouts, top multipliers, and
// what WOULD tweet under current thresholds. Does NOT post or write to SQLite.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const { createClient } = require('@supabase/supabase-js');
const { WebSocket } = require('ws');

const {
  WINS_DECIMALS,
  WINS_CURRENCY,
  WINS_MIN_PAYOUT_NATIVE,
  WINS_MIN_PAYOUT_MULTIPLIER,
  WINS_MIN_MULTIPLIER,
  WINS_MIN_MULTIPLIER_PAYOUT,
} = require('../dist/config');
const { MIN_CANDIDATE_PAYOUT_WEI } = require('../dist/wins/source');
const { isBigWin } = require('../dist/wins/selector');
const { buildWinTweet } = require('../dist/wins/formatter');

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`missing ${name} in shared root .env`); process.exit(1); }
  return v;
}

const hours = Number(process.argv[2] ?? 24);
const mode = (process.argv[3] ?? 'inserted').toLowerCase();
if (!Number.isFinite(hours) || hours <= 0) {
  console.error('usage: node scripts/wins-preview.js [hours] [inserted|block]');
  process.exit(1);
}
if (mode !== 'inserted' && mode !== 'block') {
  console.error("mode must be 'inserted' or 'block'");
  process.exit(1);
}
const filterColumn = mode === 'inserted' ? 'inserted_at' : 'block_timestamp';

const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
});

const weiToNative = (raw) => Number(raw) / 10 ** WINS_DECIMALS;
const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const tsRange = (rows, key) => {
  const xs = rows.map((r) => r[key]).filter(Boolean).sort();
  return xs.length ? { min: xs[0], max: xs[xs.length - 1] } : null;
};

(async () => {
  const sinceIso = new Date(Date.now() - hours * 3600_000).toISOString();
  console.log(`\n=== wins-preview ===`);
  console.log(`Window: last ${hours}h filtered by ${filterColumn} (since ${sinceIso})`);
  console.log(`Pre-filter: payout_wei >= ${MIN_CANDIDATE_PAYOUT_WEI} (= ${fmt(Number(MIN_CANDIDATE_PAYOUT_WEI) / 10 ** WINS_DECIMALS)} ${WINS_CURRENCY} — anything below this can't qualify under either path)`);
  console.log(`Thresholds: path A payout>=${fmt(WINS_MIN_PAYOUT_NATIVE)} ${WINS_CURRENCY} & mult>=${WINS_MIN_PAYOUT_MULTIPLIER}x`);
  console.log(`            path B mult>=${WINS_MIN_MULTIPLIER}x & payout>=${fmt(WINS_MIN_MULTIPLIER_PAYOUT)} ${WINS_CURRENCY}`);

  // Paginate (still — even with pre-filter, lots of wins are >= 1k APE)
  const PAGE_SIZE = 1000;
  const MAX_TOTAL = 50_000;
  const rows = [];
  let offset = 0;
  while (rows.length < MAX_TOTAL) {
    const { data, error } = await supabase
      .from('game_ended_events')
      .select('event_id, game_address, user_address, buy_in_wei, payout_wei, profit_wei, block_timestamp, inserted_at')
      .gte('payout_wei', MIN_CANDIDATE_PAYOUT_WEI)
      .gte(filterColumn, sinceIso)
      .order(filterColumn, { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) { console.error('supabase query failed:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    rows.push(...data);
    process.stdout.write(`  paginating... ${rows.length} candidates so far\r`);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  process.stdout.write('\n');

  console.log(`\nFetched ${rows.length} candidate rows (payout >= ${fmt(Number(MIN_CANDIDATE_PAYOUT_WEI) / 10 ** WINS_DECIMALS)} ${WINS_CURRENCY}).`);
  if (rows.length === 0) {
    console.log('(no candidates in window — broaden window, switch mode, or check that the bot is querying the right table)');
    return;
  }
  if (rows.length >= MAX_TOTAL) {
    console.log(`(hit MAX_TOTAL=${MAX_TOTAL} safety cap)`);
  }

  const insertedRange = tsRange(rows, 'inserted_at');
  const blockRange = tsRange(rows, 'block_timestamp');
  console.log(`  inserted_at  range: ${insertedRange.min}  →  ${insertedRange.max}`);
  console.log(`  block_timestamp range: ${blockRange.min}  →  ${blockRange.max}`);

  // Resolve user identities (chunked to stay under URL length & 1000-row response caps)
  const userAddrs = Array.from(new Set(rows.map((r) => r.user_address)));
  const userByAddr = new Map();
  const CHUNK = 200;
  for (let i = 0; i < userAddrs.length; i += CHUNK) {
    const slice = userAddrs.slice(i, i + CHUNK);
    const { data: users, error: uerr } = await supabase
      .from('users')
      .select('user_address, username, x_handle')
      .in('user_address', slice);
    if (uerr) { console.error('users query failed:', uerr.message); process.exit(1); }
    for (const u of users ?? []) userByAddr.set(u.user_address, u);
  }

  // Normalize to WinEvent shape
  const wins = rows.map((g) => {
    const buyInNative = weiToNative(g.buy_in_wei);
    const payoutNative = weiToNative(g.payout_wei);
    const profitNative = weiToNative(g.profit_wei);
    const user = userByAddr.get(g.user_address);
    return {
      eventId: g.event_id,
      gameAddress: g.game_address.toLowerCase(),
      userAddress: g.user_address.toLowerCase(),
      buyInNative,
      payoutNative,
      profitNative,
      multiplier: buyInNative > 0 ? payoutNative / buyInNative : null,
      blockTimestamp: Math.floor(Date.parse(g.block_timestamp) / 1000),
      blockIso: g.block_timestamp,
      insertedIso: g.inserted_at,
      username: user?.username ?? null,
      xHandle: user?.x_handle ?? null,
    };
  });

  // ---- Distribution diagnostics ----
  const freeBets = wins.filter((w) => w.buyInNative === 0).length;
  const passPathA = wins.filter((w) => w.payoutNative >= WINS_MIN_PAYOUT_NATIVE).length;
  const passPathAFull = wins.filter((w) =>
    w.payoutNative >= WINS_MIN_PAYOUT_NATIVE &&
    (w.multiplier === null || w.multiplier >= WINS_MIN_PAYOUT_MULTIPLIER),
  ).length;
  const passPathB = wins.filter((w) =>
    w.multiplier !== null &&
    w.multiplier >= WINS_MIN_MULTIPLIER &&
    w.payoutNative >= WINS_MIN_MULTIPLIER_PAYOUT,
  ).length;
  // NB: must wrap in arrow — `.filter(isBigWin)` would pass (element, index, array)
  // and bind `index` to the optional `criteria` parameter, breaking comparisons.
  const qualifying = wins.filter((w) => isBigWin(w));

  console.log(`\n--- Distribution ---`);
  console.log(`  total rows: ${wins.length}`);
  console.log(`  free bets (buy_in=0): ${freeBets}`);
  console.log(`  payout >= ${fmt(WINS_MIN_PAYOUT_NATIVE)} ${WINS_CURRENCY}:           ${passPathA}`);
  console.log(`  ↳ ALSO mult >= ${WINS_MIN_PAYOUT_MULTIPLIER}x (path A pass):   ${passPathAFull}`);
  console.log(`  mult >= ${WINS_MIN_MULTIPLIER}x AND payout >= ${fmt(WINS_MIN_MULTIPLIER_PAYOUT)} (path B pass): ${passPathB}`);
  console.log(`  TOTAL QUALIFYING (A ∪ B): ${qualifying.length}`);

  // ---- Top observations regardless of threshold ----
  const topPayout = [...wins].sort((a, b) => b.payoutNative - a.payoutNative).slice(0, 10);
  const topMult = [...wins]
    .filter((w) => w.multiplier !== null)
    .sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0))
    .slice(0, 10);

  console.log(`\n--- Top 10 payouts in window ---`);
  for (const w of topPayout) {
    const m = w.multiplier !== null ? `${w.multiplier.toFixed(2)}x` : '∞x';
    console.log(`  ${w.blockIso}  payout=${fmt(w.payoutNative)} ${WINS_CURRENCY}  buyIn=${fmt(w.buyInNative)}  mult=${m}  ${w.eventId}`);
  }

  console.log(`\n--- Top 10 multipliers in window ---`);
  for (const w of topMult) {
    console.log(`  ${w.blockIso}  mult=${w.multiplier.toFixed(2)}x  payout=${fmt(w.payoutNative)} ${WINS_CURRENCY}  buyIn=${fmt(w.buyInNative)}  ${w.eventId}`);
  }

  if (qualifying.length === 0) {
    console.log(`\n(no events would have qualified under current thresholds)`);
    console.log(`Reasons to investigate:`);
    console.log(`  • Top payout is ${fmt(topPayout[0]?.payoutNative ?? 0)} ${WINS_CURRENCY} — is the threshold ${fmt(WINS_MIN_PAYOUT_NATIVE)} too high?`);
    console.log(`  • Top multiplier is ${(topMult[0]?.multiplier ?? 0).toFixed(2)}x — is the threshold ${WINS_MIN_MULTIPLIER}x too high?`);
    console.log(`  • Try the other mode: node scripts/wins-preview.js ${hours} ${mode === 'inserted' ? 'block' : 'inserted'}`);
    return;
  }

  console.log(`\n--- ${qualifying.length} qualifying events (newest first by ${filterColumn}) ---`);
  for (const w of qualifying.slice(0, 25)) {
    const tweet = buildWinTweet(w).text;
    console.log(`\n[block=${w.blockIso}] event=${w.eventId}`);
    console.log(`  buyIn=${fmt(w.buyInNative)}  payout=${fmt(w.payoutNative)}  mult=${w.multiplier !== null ? w.multiplier.toFixed(2) + 'x' : '∞'}`);
    console.log(`  WOULD TWEET:\n  ${tweet.split('\n').join('\n  ')}`);
  }
  if (qualifying.length > 25) {
    console.log(`\n  ...and ${qualifying.length - 25} more.`);
  }
})().catch((err) => { console.error('failed:', err); process.exit(1); });
