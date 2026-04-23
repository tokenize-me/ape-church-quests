// index.js
require('dotenv').config();
const { createPublicClient, webSocket, decodeEventLog } = require('viem');
const { apechain } = require('viem/chains');
const { createClient } = require('@supabase/supabase-js');
const { zeroAddress } = require('viem');

// --- CONFIGURATION ---
const { APECHAIN_WSS_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const NOTIFY_ADDRESS = '0x7f2a0BAE8323f54C077b09ff7826064cbd55BD23';
const E2E_PREFIX = 'acdm:v1:';

// --- event_notifications fan-out constants (ApeChain mainnet only) ---
const CHAIN_ID = 33139;

// Lowercased addresses — used as listener targets, as map keys, and in skip-guards.
const ScratchCardAddress         = '0x073356f1aec3578b06efb6c45b9cd071e7d7c33d';
const SmallScratchCardAddress    = '0x20bb8f6fe56e53fd4eb0cc628d761ddf7037ef30';
const MissionaryRunestoneAddress = '0x5341a9adbe746ad90332c215f7f8a074d57ca145';
const LootBoxNFTAddress          = '0x97c0586474238be970cc2d8f7536bc63b5bbca40';
const GimbozAddress              = '0x81c9ce55e8214fd0f5181fd3d38f52fd8c33ec38';
const GimbozVialAddress          = '0xe467ede8c1c73770e7a5775c5375194a64dff444';
const GimbozElixirAddress        = '0x791ae24887009ce39cf48e05639b629d9073c85f';
const GimbozCaskAddress          = '0xba8c956575a6f5f66fec2e14ab8aa1d7785ac7a3';
const GimboWhitelistAddress      = '0x82756e1da6c2b75508cb9e82d7c99645b6daa546';
const MIDAS_PENDANT_ADDRESS      = '0xa9b992bee3a12ef6381c7cf0672c0fc158a39bb7';
const BananaWheelAddress         = '0x3680c8481d7b331325ef2bc3da9d7f9752f24d0c';
const GimbozRouletteAddress      = '0xc799ef866e092dc052872b45a8ea4c39a212b955';
const MarketplaceAddress         = '0x6af679e13caaf36f088a540e86ed2b18a4de11af';
const NFTPackAddress             = '0xd275a7f641827305c1e2958b5c93b325c8b8f0da';
const EXPManagerAddress          = '0x0382338F3876237Ae89317A6a8207C432D430b93';

const NFT_NAME_MAP = {
  [LootBoxNFTAddress]:          'Loot Box NFT',
  [ScratchCardAddress]:         'Scratch Card NFT',
  [SmallScratchCardAddress]:    'Jr Scratch Card NFT',
  [GimboWhitelistAddress]:      'Gimbo Whitelist NFT',
  [MissionaryRunestoneAddress]: 'Missionary Runestone NFT',
  [GimbozAddress]:              'Gimboz NFT',
  [GimbozVialAddress]:          'Gimboz Vial NFT',
  [GimbozElixirAddress]:        'Gimboz Elixir NFT',
  [GimbozCaskAddress]:          'Gimboz Cask NFT',
  [MIDAS_PENDANT_ADDRESS]:      'Midas Pendant NFT',
};

// --- ABI DEFINITIONS ---

// ✅ ABI for FILTERING: This has the correct signature to find the event topic.
const notifyAbi = [
    {
      type: 'event',
      name: 'SentETH',
      anonymous: false,
      inputs: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'value', type: 'uint256', indexed: false },
        { name: 'message', type: 'string', indexed: false },
      ],
    },
    {
      type: 'event',
      name: 'SentToken',
      anonymous: false,
      inputs: [
        { name: 'token', type: 'address', indexed: false },
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'value', type: 'uint256', indexed: false },
        { name: 'message', type: 'string', indexed: false },
        { name: 'tokenSymbol', type: 'string', indexed: false },
      ],
    },
    {
      type: 'event',
      name: 'SentNFT',
      anonymous: false,
      inputs: [
        { name: 'nft', type: 'address', indexed: false },
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'tokenId', type: 'uint256', indexed: false },
        { name: 'message', type: 'string', indexed: false },
        { name: 'nftSymbol', type: 'string', indexed: false },
      ],
    },
  ];

// --- ABIs for event_notifications fan-out ---
const erc721TransferAbi = [
  {
    type: 'event',
    name: 'Transfer',
    anonymous: false,
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
];

const bananaWheelAbi = [
  {
    type: 'event',
    name: 'GameStarted',
    anonymous: false,
    inputs: [{ name: 'gameId', type: 'uint256', indexed: false }],
  },
];

const gimbozRouletteAbi = [
  {
    type: 'event',
    name: 'GameCreated',
    anonymous: false,
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: false },
      { name: 'creator', type: 'address', indexed: false },
      { name: 'allowedPlayers', type: 'address[]', indexed: false },
    ],
  },
];

const marketplaceAbi = [
  {
    type: 'event',
    name: 'Sale',
    anonymous: false,
    inputs: [
      { name: 'collection', type: 'address', indexed: true },
      { name: 'tokenId',    type: 'uint256', indexed: true },
      { name: 'seller',     type: 'address', indexed: false },
      { name: 'buyer',      type: 'address', indexed: true },
      { name: 'price',      type: 'uint256', indexed: false },
      { name: 'feeAmount',  type: 'uint256', indexed: false },
    ],
  },
];

// --- CLIENT INITIALIZATION ---
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const publicClient = createPublicClient({
  chain: apechain,
  transport: webSocket(APECHAIN_WSS_URL),
});

// --- TTL caches for event_notifications dedupe ---
// Map-based; insertion order matches expiry order since each cache has a uniform TTL,
// so sweep-on-write in insertion order is O(expired).
class TTLCache {
  constructor(ttlMs, maxSize = 10000) {
    this.ttl = ttlMs;
    this.max = maxSize;
    this.map = new Map();
  }
  _sweep() {
    const now = Date.now();
    for (const [k, exp] of this.map) {
      if (exp <= now) this.map.delete(k);
      else break;
    }
    while (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value);
    }
  }
  has(key) {
    const exp = this.map.get(key);
    if (exp === undefined) return false;
    if (exp <= Date.now()) { this.map.delete(key); return false; }
    return true;
  }
  set(key) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, Date.now() + this.ttl);
    this._sweep();
  }
}

// SentNFT tx hashes — gate raw-Transfer inserts so the richer notify row wins.
// 30s TTL doubles the frontend's 15s to cover WSS-reordering races.
const notifyNftTxCache = new TTLCache(30 * 1000, 5000);

// gameId LRU for BananaWheel.GameStarted — keeps the hot path off Postgres.
const seenBananaGameIds = new TTLCache(24 * 60 * 60 * 1000, 5000);

// (gameId, invitee) LRU for GimbozRoulette.GameCreated fan-out.
const seenGimbozInvites = new TTLCache(24 * 60 * 60 * 1000, 20000);

// General event dedupe: (chain_id, tx_hash, log_index, recipient) — mirrors the DB unique key.
const eventDedupeCache = new TTLCache(10 * 60 * 1000, 10000);

// --- event_notifications insert helper ---
// Swallows unique-constraint conflicts (23505) as a success; everything else logs and returns.
// Never throws — callers should not let an event_notifications failure affect notify_events.
async function insertEventNotification({ type, recipient, txHash, logIndex, data }) {
  try {
    const txLower = txHash.toLowerCase();
    const recipLower = recipient ? recipient.toLowerCase() : null;
    const dedupeKey = `${CHAIN_ID}-${txLower}-${logIndex}-${recipLower ?? ''}`;

    if (eventDedupeCache.has(dedupeKey)) return;

    const row = {
      type,
      recipient_address: recipLower,
      chain_id: CHAIN_ID,
      tx_hash: txLower,
      log_index: Number(logIndex),
      data,
    };

    const { error } = await supabase.from('event_notifications').insert(row);

    if (error) {
      if (error.code === '23505') {
        eventDedupeCache.set(dedupeKey);
        return;
      }
      console.error(`[event_notifications:${type}] insert error:`, error.message || error);
      return;
    }

    eventDedupeCache.set(dedupeKey);
    console.log(`✅ [event_notifications:${type}] ${recipLower ?? 'GLOBAL'} tx=${txLower} log=${logIndex}`);
  } catch (e) {
    console.error(`[event_notifications:${type}] unexpected:`, e.message || e);
  }
}

function getE2EMetadata(message) {
  if (!message || !message.startsWith(E2E_PREFIX)) {
    return { is_e2e: false, e2e_version: null, e2e_parse_error: null };
  }

  try {
    const payload = JSON.parse(message.slice(E2E_PREFIX.length));

    if (payload?.v !== 1) {
      return { is_e2e: true, e2e_version: 'v1', e2e_parse_error: 'invalid_v' };
    }

    if (payload?.alg !== 'ecies-secp256k1') {
      return { is_e2e: true, e2e_version: 'v1', e2e_parse_error: 'invalid_alg' };
    }

    if (typeof payload?.to !== 'string' || payload.to.length === 0) {
      return { is_e2e: true, e2e_version: 'v1', e2e_parse_error: 'missing_to' };
    }

    if (typeof payload?.from !== 'string' || payload.from.length === 0) {
      return { is_e2e: true, e2e_version: 'v1', e2e_parse_error: 'missing_from' };
    }

    return { is_e2e: true, e2e_version: 'v1', e2e_parse_error: null };
  } catch (e) {
    return { is_e2e: true, e2e_version: 'v1', e2e_parse_error: 'invalid_json' };
  }
}

function runE2EMetadataQACases() {
  const qaCases = [
    {
      name: 'plaintext message',
      input: 'hello world',
      expected: { is_e2e: false, e2e_version: null, e2e_parse_error: null },
    },
    {
      name: 'empty gift-only message',
      input: '',
      expected: { is_e2e: false, e2e_version: null, e2e_parse_error: null },
    },
    {
      name: 'valid acdm payload',
      input: `${E2E_PREFIX}{"v":1,"alg":"ecies-secp256k1","to":"0xabc","from":"0xdef"}`,
      expected: { is_e2e: true, e2e_version: 'v1', e2e_parse_error: null },
    },
    {
      name: 'broken prefixed payload',
      input: `${E2E_PREFIX}{"v":1,`,
      expected: { is_e2e: true, e2e_version: 'v1', e2e_parse_error: 'invalid_json' },
    },
  ];

  for (const qaCase of qaCases) {
    const actual = getE2EMetadata(qaCase.input);
    const passed =
      actual.is_e2e === qaCase.expected.is_e2e &&
      actual.e2e_version === qaCase.expected.e2e_version &&
      actual.e2e_parse_error === qaCase.expected.e2e_parse_error;

    if (!passed) {
      console.error(`[E2E QA] Failed: ${qaCase.name}`, { expected: qaCase.expected, actual });
    }
  }
}

runE2EMetadataQACases();

console.log('✅ Services Initialized. Starting listeners...');

// --- LISTENER 1: TokenCreate Events ---
publicClient.watchContractEvent({
  address: NOTIFY_ADDRESS,
  abi: notifyAbi,
  eventName: 'SentETH',
  onLogs: async (logs) => {
    for (const log of logs) {
      try {
        const decodedLog = decodeEventLog({
          abi: notifyAbi,
          data: log.data,
          topics: log.topics,
        });

        console.log(`[SentETH] Event for ${decodedLog.args.from} to ${decodedLog.args.to}.`);

        const from_address = decodedLog.args.from.toString().toLowerCase();
        const to_address = decodedLog.args.to.toString().toLowerCase();

        const giftType = decodedLog.args.value ? (decodedLog.args.value > BigInt(0) ? 'ETH' : 'NONE') : 'NONE';
        const message = decodedLog.args.message ?? '';
        const e2eMetadata = getE2EMetadata(message);

        const record = {
            tx_hash: log.transactionHash.toLowerCase(),
            log_index: Number(log.logIndex),
          
            from_address: from_address,
            to_address: to_address,
          
            message,
          
            gift_type: giftType,
            asset_address: zeroAddress,    // null for ETH is also fine; pick one convention
            asset_symbol: 'APE',
          
            amount_raw: decodedLog.args.value?.toString() ?? null, // for ETH/TOKEN
            token_id: null,                                   // for NFT use tokenId
            is_e2e: e2eMetadata.is_e2e,
            e2e_version: e2eMetadata.e2e_version,
            e2e_parse_error: e2eMetadata.e2e_parse_error,
          };

          if (e2eMetadata.e2e_parse_error) {
            console.warn(
              `[SentETH] E2E parse failure (${e2eMetadata.e2e_parse_error}) for tx ${record.tx_hash}`
            );
          }
  
          console.log('Adding new SentETH record to Supabase:', record);
          
          const { error } = await supabase
            .from('notify_events')
            .upsert(record, { onConflict: 'tx_hash,log_index', ignoreDuplicates: true });

        if (error) {
          console.error('[SentETH] Supabase error:', error);
        } else {
          console.log(`✅ [SentETH] Inserted: ${decodedLog.args.from} to ${decodedLog.args.to}`);
        }

        // --- dual-write to event_notifications (does not affect notify_events above) ---
        if (to_address !== zeroAddress && from_address !== zeroAddress) {
          await insertEventNotification({
            type: 'notify.eth.received',
            recipient: to_address,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            data: {
              to: to_address,
              from: from_address,
              valueWei: decodedLog.args.value?.toString() ?? '0',
              message,
            },
          });
        }
      } catch (e) {
        console.error(`[SentETH] Failed to process log. Error: ${e.message}`);
      }
    }
  },
  onError: (error) => console.error('[SentETH] Listener error:', error.message)
});

// --- LISTENER 1: TokenCreate Events ---
publicClient.watchContractEvent({
    address: NOTIFY_ADDRESS,
    abi: notifyAbi,
    eventName: 'SentToken',
    onLogs: async (logs) => {
      for (const log of logs) {
        try {
          const decodedLog = decodeEventLog({
            abi: notifyAbi,
            data: log.data,
            topics: log.topics,
          });
  
          console.log(`[SentToken] Event for ${decodedLog.args.from} to ${decodedLog.args.to}.`);

          const from_address = decodedLog.args.from.toString().toLowerCase();
          const to_address = decodedLog.args.to.toString().toLowerCase();
          
          const message = decodedLog.args.message ?? '';
          const e2eMetadata = getE2EMetadata(message);

          const record = {
            tx_hash: log.transactionHash.toLowerCase(),
            log_index: Number(log.logIndex),
          
            from_address: from_address,
            to_address: to_address,
          
            message,
          
            gift_type: 'TOKEN',              // 'TOKEN' | 'NFT'
            asset_address: decodedLog.args.token.toLowerCase(),    // null for ETH is also fine; pick one convention
            asset_symbol: decodedLog.args.tokenSymbol,
          
            amount_raw: decodedLog.args.value?.toString() ?? null, // for ETH/TOKEN
            token_id: null,                                   // for NFT use tokenId
            is_e2e: e2eMetadata.is_e2e,
            e2e_version: e2eMetadata.e2e_version,
            e2e_parse_error: e2eMetadata.e2e_parse_error,
          };

          if (e2eMetadata.e2e_parse_error) {
            console.warn(
              `[SentToken] E2E parse failure (${e2eMetadata.e2e_parse_error}) for tx ${record.tx_hash}`
            );
          }
  
          console.log('Adding new SentToken record to Supabase:', record);
          
          const { error } = await supabase
            .from('notify_events')
            .upsert(record, { onConflict: 'tx_hash,log_index', ignoreDuplicates: true });
  
          if (error) {
            console.error('[SentToken] Supabase error:', error);
          } else {
            console.log(`✅ [SentToken] Inserted: ${decodedLog.args.from} to ${decodedLog.args.to}`);
          }

          // --- dual-write to event_notifications ---
          if (to_address !== zeroAddress && from_address !== zeroAddress) {
            const tokenAddr = decodedLog.args.token?.toString().toLowerCase();
            await insertEventNotification({
              type: 'notify.token.received',
              recipient: to_address,
              txHash: log.transactionHash,
              logIndex: log.logIndex,
              data: {
                to: to_address,
                from: from_address,
                tokenAddress: tokenAddr,
                tokenSymbol: decodedLog.args.tokenSymbol ?? '',
                isGP: tokenAddr === EXPManagerAddress.toLowerCase(),
                rawValue: decodedLog.args.value?.toString() ?? '0',
                message,
              },
            });
          }
        } catch (e) {
          console.error(`[SentToken] Failed to process log. Error: ${e.message}`);
        }
      }
    },
    onError: (error) => console.error('[SentToken] Listener error:', error.message)
  });

// --- LISTENER 1: TokenCreate Events ---
publicClient.watchContractEvent({
    address: NOTIFY_ADDRESS,
    abi: notifyAbi,
    eventName: 'SentNFT',
    onLogs: async (logs) => {
      for (const log of logs) {
        try {
          const decodedLog = decodeEventLog({
            abi: notifyAbi,
            data: log.data,
            topics: log.topics,
          });
  
          console.log(`[SentNFT] Event for ${decodedLog.args.from} to ${decodedLog.args.to}.`);

          const from_address = decodedLog.args.from.toString().toLowerCase();
          const to_address = decodedLog.args.to.toString().toLowerCase();

          // Mark this tx BEFORE the insert so a paired raw-Transfer processed
          // concurrently sees the flag and skips. Spec §6.8.
          const nftTxHash = log.transactionHash.toLowerCase();
          notifyNftTxCache.set(`${CHAIN_ID}-${nftTxHash}`);

          const message = decodedLog.args.message ?? '';
          const e2eMetadata = getE2EMetadata(message);

          const record = {
            tx_hash: log.transactionHash.toLowerCase(),
            log_index: Number(log.logIndex),
          
            from_address: from_address,
            to_address: to_address,
          
            message,
            
            gift_type: 'NFT',              // 'TOKEN' | 'NFT'
            asset_address: decodedLog.args.nft.toLowerCase(),    // null for ETH is also fine; pick one convention
            asset_symbol: decodedLog.args.nftSymbol,
          
            amount_raw: null,
            token_id: decodedLog.args.tokenId?.toString() ?? null,
            is_e2e: e2eMetadata.is_e2e,
            e2e_version: e2eMetadata.e2e_version,
            e2e_parse_error: e2eMetadata.e2e_parse_error,
          };

          if (e2eMetadata.e2e_parse_error) {
            console.warn(
              `[SentNFT] E2E parse failure (${e2eMetadata.e2e_parse_error}) for tx ${record.tx_hash}`
            );
          }
  
          console.log('Adding new SentNFT record to Supabase:', record);
          
          const { error } = await supabase
            .from('notify_events')
            .upsert(record, { onConflict: 'tx_hash,log_index', ignoreDuplicates: true });
  
          if (error) {
            console.error('[SentNFT] Supabase error:', error);
          } else {
            console.log(`✅ [SentNFT] Inserted: ${decodedLog.args.from} to ${decodedLog.args.to}`);
          }

          // --- dual-write to event_notifications ---
          if (to_address !== zeroAddress && from_address !== zeroAddress) {
            const nftAddr = decodedLog.args.nft?.toString().toLowerCase();
            await insertEventNotification({
              type: 'nft.received',
              recipient: to_address,
              txHash: log.transactionHash,
              logIndex: log.logIndex,
              data: {
                to: to_address,
                from: from_address,
                nftAddress: nftAddr,
                nftName: NFT_NAME_MAP[nftAddr] ?? decodedLog.args.nftSymbol ?? 'NFT',
                nftSymbol: decodedLog.args.nftSymbol ?? null,
                tokenId: decodedLog.args.tokenId?.toString() ?? '0',
                message,
                source: 'notify',
              },
            });
          }
        } catch (e) {
          console.error(`[SentNFT] Failed to process log. Error: ${e.message}`);
        }
      }
    },
    onError: (error) => console.error('[SentNFT] Listener error:', error.message)
  });
console.log(`Listening for "SentETH" and "SentToken" and "SentNFT" events...`);

// ============================================================================
// event_notifications: additional listeners (events 1-7 from spec)
// These only write to public.event_notifications. They do NOT touch notify_events.
// ============================================================================

// Raw ERC-721 Transfer listener factory (events 1-4).
// Skip guards: mint, NFT Pack reveals, and tx hashes already claimed by a SentNFT.
function registerTransferListener(address, nftName) {
  publicClient.watchContractEvent({
    address,
    abi: erc721TransferAbi,
    eventName: 'Transfer',
    onLogs: async (logs) => {
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({
            abi: erc721TransferAbi,
            data: log.data,
            topics: log.topics,
          });

          const from = decoded.args.from.toString().toLowerCase();
          const to   = decoded.args.to.toString().toLowerCase();
          const tokenId = decoded.args.tokenId.toString();
          const txHash = log.transactionHash.toLowerCase();

          if (to === zeroAddress) continue;
          if (from === zeroAddress) continue;              // mint
          if (from === NFTPackAddress) continue;           // pack reveals own their UI
          if (notifyNftTxCache.has(`${CHAIN_ID}-${txHash}`)) continue; // SentNFT wins

          await insertEventNotification({
            type: 'nft.received',
            recipient: to,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            data: {
              to,
              from,
              nftAddress: address,
              nftName,
              nftSymbol: null,
              tokenId,
              message: null,
              source: 'transfer',
            },
          });
        } catch (e) {
          console.error(`[Transfer ${nftName}] failed:`, e.message);
        }
      }
    },
    onError: (error) => console.error(`[Transfer ${nftName}] listener error:`, error.message),
  });
}

registerTransferListener(ScratchCardAddress,         'Scratch Card NFT');
registerTransferListener(SmallScratchCardAddress,    'Jr Scratch Card NFT');
registerTransferListener(MissionaryRunestoneAddress, 'Missionary Runestone NFT');
registerTransferListener(LootBoxNFTAddress,          'Loot Box NFT');

// Event 5: BananaWheel.GameStarted — global, dedupe by gameId.
publicClient.watchContractEvent({
  address: BananaWheelAddress,
  abi: bananaWheelAbi,
  eventName: 'GameStarted',
  onLogs: async (logs) => {
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi: bananaWheelAbi, data: log.data, topics: log.topics });
        const gameId = decoded.args.gameId.toString();

        if (seenBananaGameIds.has(gameId)) continue;
        seenBananaGameIds.set(gameId);

        await insertEventNotification({
          type: 'game.banana_wheel.started',
          recipient: null,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          data: { gameId },
        });
      } catch (e) {
        console.error('[BananaWheel GameStarted] failed:', e.message);
      }
    }
  },
  onError: (error) => console.error('[BananaWheel GameStarted] listener error:', error.message),
});

// Event 6: GimbozRoulette.GameCreated — fan out to each invitee (skip creator, skip public games).
publicClient.watchContractEvent({
  address: GimbozRouletteAddress,
  abi: gimbozRouletteAbi,
  eventName: 'GameCreated',
  onLogs: async (logs) => {
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi: gimbozRouletteAbi, data: log.data, topics: log.topics });
        const gameId = decoded.args.gameId.toString();
        const creator = decoded.args.creator.toString().toLowerCase();
        const allowed = decoded.args.allowedPlayers ?? [];

        if (allowed.length === 0) continue; // public game — frontend intentionally silent

        for (const raw of allowed) {
          const invitee = raw.toString().toLowerCase();
          if (invitee === creator) continue;

          const dedupeKey = `${gameId}:${invitee}`;
          if (seenGimbozInvites.has(dedupeKey)) continue;
          seenGimbozInvites.set(dedupeKey);

          await insertEventNotification({
            type: 'game.gimboz_roulette.invite',
            recipient: invitee,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            data: { gameId, creator, invitedPlayer: invitee },
          });
        }
      } catch (e) {
        console.error('[GimbozRoulette GameCreated] failed:', e.message);
      }
    }
  },
  onError: (error) => console.error('[GimbozRoulette GameCreated] listener error:', error.message),
});

// Event 7: Marketplace.Sale — global. Resolve nftName; fall back to "Unknown NFT".
publicClient.watchContractEvent({
  address: MarketplaceAddress,
  abi: marketplaceAbi,
  eventName: 'Sale',
  onLogs: async (logs) => {
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi: marketplaceAbi, data: log.data, topics: log.topics });
        const collection = decoded.args.collection.toString().toLowerCase();
        const seller = decoded.args.seller.toString().toLowerCase();
        const buyer  = decoded.args.buyer.toString().toLowerCase();

        if (buyer === zeroAddress || seller === zeroAddress) continue;

        await insertEventNotification({
          type: 'marketplace.sale',
          recipient: null,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          data: {
            collection,
            nftName: NFT_NAME_MAP[collection] ?? 'Unknown NFT',
            tokenId: decoded.args.tokenId.toString(),
            seller,
            buyer,
            priceWei: decoded.args.price.toString(),
            feeWei: decoded.args.feeAmount.toString(),
          },
        });
      } catch (e) {
        console.error('[Marketplace Sale] failed:', e.message);
      }
    }
  },
  onError: (error) => console.error('[Marketplace Sale] listener error:', error.message),
});

console.log('✅ event_notifications listeners armed (Transfer ×4, GameStarted, GameCreated, Sale, SentETH/Token/NFT dual-write).');