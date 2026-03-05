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

// --- CLIENT INITIALIZATION ---
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const publicClient = createPublicClient({
  chain: apechain,
  transport: webSocket(APECHAIN_WSS_URL),
});

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
        } catch (e) {
          console.error(`[SentNFT] Failed to process log. Error: ${e.message}`);
        }
      }
    },
    onError: (error) => console.error('[SentNFT] Listener error:', error.message)
  });
console.log(`Listening for "SentETH" and "SentToken" and "SentNFT" events...`);