export const DEPLOYER_ADDRESS = '0x0d69b1d26f56dee4449f5ed3998b0380aaa2fe40';

export const ACCEPTED_CHAINS = ['ethereum', 'ape_chain'] as const;
export type AcceptedChain = (typeof ACCEPTED_CHAINS)[number];

export const CHAIN_DISPLAY_NAMES: Record<AcceptedChain, string> = {
  ethereum: 'Ethereum',
  ape_chain: 'ApeChain',
};

export const QUIET_PERIOD_MS = 15_000;

export const RECONNECT_BACKOFF = {
  initialMs: 1_000,
  maxMs: 60_000,
  multiplier: 2,
} as const;

export const TWEET_TEMPLATES = {
  single:
    'ApeChurch Deployer picked up a {collectionName} for {price} {currency}.',
  multi:
    'ApeChurch Deployer has swept {count} {collectionName} NFTs for a total cost of {total} {currency}, purchasing each NFT at an average price of {average} {currency}.',
} as const;

export const IMAGE_GRID_LAYOUT: Record<number, { cols: number; rows: number }> = {
  5: { cols: 3, rows: 2 },
  6: { cols: 3, rows: 2 },
  7: { cols: 3, rows: 3 },
  8: { cols: 3, rows: 3 },
  9: { cols: 3, rows: 3 },
  10: { cols: 4, rows: 3 },
  11: { cols: 4, rows: 3 },
  12: { cols: 4, rows: 3 },
  13: { cols: 4, rows: 4 },
  14: { cols: 4, rows: 4 },
  15: { cols: 4, rows: 4 },
  16: { cols: 4, rows: 4 },
  17: { cols: 5, rows: 4 },
  18: { cols: 5, rows: 4 },
  19: { cols: 5, rows: 4 },
  20: { cols: 5, rows: 4 },
  21: { cols: 5, rows: 5 },
  22: { cols: 5, rows: 5 },
  23: { cols: 5, rows: 5 },
  24: { cols: 5, rows: 5 },
  25: { cols: 5, rows: 5 },
};

export const MAX_COLLAGE_IMAGES = 25;
export const TWITTER_NATIVE_GRID_MAX = 4;

export const COLLAGE_SIZE_PX = 1200;
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 5_000;

export const DRY_RUN = process.env.DRY_RUN === 'true';
export const STREAM_LOG_ONLY = process.env.STREAM_LOG_ONLY === 'true';

// =============================================================================
// Big-wins listener (WSS) — see notify.js for the reference pattern.
// =============================================================================

// ApeChain mainnet. Curtis testnet is 33111 — confirm before flipping if we
// ever stand up a testnet bot.
export const APECHAIN_CHAIN_ID = 33139;

// Cap on the backfill window after a restart. If lastSeen is more than this
// many blocks behind head, we skip the gap and start from head. Prevents an
// unbounded eth_getLogs call after long downtime (which Alchemy would reject
// anyway around 10k blocks for the free getLogs endpoint).
export const WINS_BACKFILL_BLOCKS_MAX = 5_000;

// Cursor key for persisted last-seen block in the local sqlite cursors table.
export const WINS_LAST_SEEN_BLOCK_KEY = 'wins_last_seen_block';

// Feature flags. Hard-coded rather than env-driven because they're effectively
// one-time cutover switches — flip the constant + redeploy if you ever need to
// run the legacy Supabase poller as a safety net alongside the listener.
// The two paths share dedup (published_wins PK locally + game_ended_events PK
// in Supabase), so enabling both is safe — won't double-tweet, won't dup rows.
export const WINS_LISTENER_ENABLED = true;
export const WINS_POLLER_ENABLED = false;

// =============================================================================
// Big-wins broadcaster (separate use case from sweeps; shares same X account)
// =============================================================================

export const WINS_POLL_INTERVAL_MS = 60_000;
export const WINS_POLL_BATCH_SIZE = 200;
export const WINS_HEARTBEAT_EVERY_POLLS = 10; // ≈ one heartbeat line per 10 minutes

// A win is "big" if EITHER path qualifies (OR — whichever fires first):
//
//   Path A (absolute):    payout >= WINS_MIN_PAYOUT_NATIVE
//                         AND multiplier >= WINS_MIN_PAYOUT_MULTIPLIER
//                         (free-bet exception: null multiplier passes path A on absolute alone)
//
//   Path B (multiplier):  multiplier >= WINS_MIN_MULTIPLIER
//                         AND payout   >= WINS_MIN_MULTIPLIER_PAYOUT
//
// Path A's multiplier guard excludes "huge bet won by a hair" wins
// (e.g. bet 14,500 APE, won 15,000 APE → only 1.03x → doesn't qualify).
// Path B's payout guard excludes "tiny bet hit a fluke multi" wins.
// All amounts in native units (APE).
export const WINS_MIN_PAYOUT_NATIVE = 15_000;       // path A: 15,000 APE gross payout
export const WINS_MIN_PAYOUT_MULTIPLIER = 1.75;     // path A: must be at least a 1.75x win
export const WINS_MIN_MULTIPLIER = 20;              // path B: 20x payout/buyIn
export const WINS_MIN_MULTIPLIER_PAYOUT = 1_000;    // path B: payout must be at least 1,000 APE

// Currency of all wins on the platform. Currently APE; widen if/when other chains added.
export const WINS_CURRENCY = 'APE';
export const WINS_DECIMALS = 18; // wei → native conversion

// Base URL for the Ape Church web app. Used to build replay links appended to
// big-win tweets. Hard-coded because it doesn't change between environments
// (the bot is single-environment, prod-only).
export const APE_CHURCH_BASE_URL = 'https://www.ape.church';

// Map of game contract address (lowercased) → URL slug for the replay page.
// Tweet URL shape: `${APE_CHURCH_BASE_URL}/games/<slug>?id=<replayId>`.
// Addresses not in this map post the tweet WITHOUT a replay link (graceful
// degradation — same policy as GAME_NAMES). Keep keys in sync with GAME_NAMES.
export const GAME_SLUGS: Record<string, string> = {
  '0x9ebb4df257b971582baf096b62ca41de7723f3cb': 'dino-dough',
  '0xb5da735118e848130b92994ee16377db2ae31a4c': 'bubblegum-heist',
  '0x7b53ec7a5e1c30d4b91d2c3ec0472a6e4818a657': 'sushi-showdown',
  '0x674bd91adb41897fa780386e610168afbb05e694': 'cosmic-plinko',
  '0xb08c669dc0419151ba4e4920e80128802db5497b': 'baccarat',
  '0xa67d5cd51028caaa367eefce90a5ea0b71c6cbe2': 'hilo',
  '0x1f48a104c1808eb4107f3999999d36aeafec56d5': 'roulette',
  '0xb02b13adb8eaafe1f41ec942612c4a4862b74d1d': 'geez-diggerz',
  '0xaf107530b56f86ecd59f03a93fb5044f32e02ae9': 'cult-quest',
  '0xc936d6691737afe5240975622f0597fa2d122fad': 'keno',
  '0x0717330c1a9e269a0e034abb101c8d32ac0e9600': 'ape-strong',
  '0x40ee3295035901e5fd80703774e5a9fe7ce2b90c': 'speed-keno',
  '0x4f7d016704bc9a1d373e512e10cf86a0e7015d1d': 'gimboz-poker',
  '0x03ac9d823ccc27df9f0981fd3975ca6f13067ed7': 'blackjack',
  '0x17e219844f25f3fed6e422ddaffd2e6557ebced3': 'gimboz-smash',
  '0x59ebd3406b76dcc74102afa2ca5284e9aab6ba28': 'monkey-match',
  '0x88683b2f9e765e5b1ec2745178354c70a03531ce': 'jungle-plinko',
  '0x6a48a513a46955d8622c809fce876d2f11142003': 'bear-dice',
  '0x5b44ce34300d1b8d32b5a6119f192e3eda74e144': 'speed-crash',
  '0xa59cf828222ecd8ace4b6195764d11f5ea7f62a6': 'blocks',
  '0xc1acd12aa34dc33979871ef95c540d46a6566b4b': 'primes',
  '0xc1046a6b4c01512803772b25f72d9f6ff27f94a7': 'ricos-revenge',
  '0x5e405198b349d6522bbb614e7391bdc4f4f6f681': 'reel-pirates',
  '0x7c1bead2a3411f1169ed57b2031b0a6a2981809b': 'street-looker',
  '0x37f050aed673a951937af6161a04e9ff604544b2': 'foxy-shooter',
  '0x64b27c1c69559a795c98958614398dd7195ae1b8': 'blizzard-blitz',
  '0x1ac78e6a153deed1b8db67b9813991651d53e3a6': 'gimboz-of-the-galaxy',
  '0x25c170c9c0480b1c8e9e13667fddb87685e50f11': 'ape-church-downs',
  '0x4c4bf42d114c9ab912603d5156f030196975d1cd': 'rillaxe',
  '0x4fe5712e07e64b93dddf6a114d15a9c68f1d6ceb': 'pop-n-drop',
};

// Map of game contract address (lowercased) → human-readable display name.
// Keys MUST be lowercase — formatter.ts looks up via address.toLowerCase().
// Addresses not in this map fall back to "a game (0xabc…123)".
export const GAME_NAMES: Record<string, string> = {
  '0x9ebb4df257b971582baf096b62ca41de7723f3cb': 'Slots (DinoDough)',
  '0xb5da735118e848130b92994ee16377db2ae31a4c': 'Slots (BubbleGum Heist)',
  '0x7b53ec7a5e1c30d4b91d2c3ec0472a6e4818a657': 'Slots (Sushi Showdown)',
  '0x674bd91adb41897fa780386e610168afbb05e694': 'Cosmic Plinko',
  '0xb08c669dc0419151ba4e4920e80128802db5497b': 'Baccarat',
  '0xa67d5cd51028caaa367eefce90a5ea0b71c6cbe2': 'HighLow',
  '0x1f48a104c1808eb4107f3999999d36aeafec56d5': 'Roulette',
  '0xb02b13adb8eaafe1f41ec942612c4a4862b74d1d': 'Slots (GeezDiggers)',
  '0xaf107530b56f86ecd59f03a93fb5044f32e02ae9': 'Cult Quest',
  '0xc936d6691737afe5240975622f0597fa2d122fad': 'Keno',
  '0x0717330c1a9e269a0e034abb101c8d32ac0e9600': 'Ape Strong',
  '0x40ee3295035901e5fd80703774e5a9fe7ce2b90c': 'Speed Keno',
  '0x4f7d016704bc9a1d373e512e10cf86a0e7015d1d': 'Video Poker',
  '0x03ac9d823ccc27df9f0981fd3975ca6f13067ed7': 'Blackjack',
  '0x17e219844f25f3fed6e422ddaffd2e6557ebced3': 'GimboSmash',
  '0x59ebd3406b76dcc74102afa2ca5284e9aab6ba28': 'Monkey Match',
  '0x88683b2f9e765e5b1ec2745178354c70a03531ce': 'Jungle Plinko',
  '0x6a48a513a46955d8622c809fce876d2f11142003': 'BearADice',
  '0x5b44ce34300d1b8d32b5a6119f192e3eda74e144': 'Speed Crash',
  '0xa59cf828222ecd8ace4b6195764d11f5ea7f62a6': 'Blocks',
  '0xc1acd12aa34dc33979871ef95c540d46a6566b4b': 'Primes',
  '0xc1046a6b4c01512803772b25f72d9f6ff27f94a7': 'Ricos Revenge',
  '0x5e405198b349d6522bbb614e7391bdc4f4f6f681': 'Reel Pirates',
  '0x7c1bead2a3411f1169ed57b2031b0a6a2981809b': 'Street Looker',
  '0x37f050aed673a951937af6161a04e9ff604544b2': 'Foxy Shooter',
  '0x64b27c1c69559a795c98958614398dd7195ae1b8': 'Blizzard Blitz',
  '0x1ac78e6a153deed1b8db67b9813991651d53e3a6': 'Gimboz Of The Galaxy',
  '0x25c170c9c0480b1c8e9e13667fddb87685e50f11': 'ApeChurch Downs',
  '0x4c4bf42d114c9ab912603d5156f030196975d1cd': 'RillAxe',
  '0x4fe5712e07e64b93dddf6a114d15a9c68f1d6ceb': 'Pop N Drop Plinko',
};

// Win tweet template. Placeholders: {playerDisplay}, {payout}, {currency}, {gameName}, {buyIn}, {multiplier}
// The "BIG WIN ALERT!" prefix on its own line prevents X from interpreting the tweet as a
// reply when {playerDisplay} starts with "@handle".
export const WIN_TWEET_TEMPLATE =
  'BIG WIN ALERT!\n{playerDisplay} won {payout} {currency} on {gameName} from a {buyIn} {currency} bet ({multiplier}x).';

// Game contract addresses the WSS listener subscribes to. Derived from GAME_NAMES
// so adding a game in one place wires it up everywhere (listener, slug lookup,
// display name). Cast through `0x${string}[]` because viem's `address` type wants
// the template literal form.
export const TRACKED_GAME_ADDRESSES = Object.keys(GAME_NAMES) as `0x${string}`[];
