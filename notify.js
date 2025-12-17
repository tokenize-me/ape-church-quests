// index.js
require('dotenv').config();
const { createPublicClient, webSocket, decodeEventLog } = require('viem');
const { apechain } = require('viem/chains');
const { createClient } = require('@supabase/supabase-js');
const { zeroAddress } = require('viem');

// --- CONFIGURATION ---
const { APECHAIN_WSS_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const NOTIFY_ADDRESS = '0x7f2a0BAE8323f54C077b09ff7826064cbd55BD23';

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

        const record = {
            tx_hash: log.transactionHash.toLowerCase(),
            log_index: Number(log.logIndex),
          
            from_address: from_address,
            to_address: to_address,
          
            message: decodedLog.args.message ?? '',
          
            gift_type: giftType,
            asset_address: zeroAddress,    // null for ETH is also fine; pick one convention
            asset_symbol: 'APE',
          
            amount_raw: decodedLog.args.value?.toString() ?? null, // for ETH/TOKEN
            token_id: null,                                   // for NFT use tokenId
          };
  
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
          
          const record = {
            tx_hash: log.transactionHash.toLowerCase(),
            log_index: Number(log.logIndex),
          
            from_address: from_address,
            to_address: to_address,
          
            message: decodedLog.args.message ?? '',
          
            gift_type: 'TOKEN',              // 'TOKEN' | 'NFT'
            asset_address: decodedLog.args.token.toLowerCase(),    // null for ETH is also fine; pick one convention
            asset_symbol: decodedLog.args.tokenSymbol,
          
            amount_raw: decodedLog.args.value?.toString() ?? null, // for ETH/TOKEN
            token_id: null,                                   // for NFT use tokenId
          };
  
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
          
          const record = {
            tx_hash: log.transactionHash.toLowerCase(),
            log_index: Number(log.logIndex),
          
            from_address: from_address,
            to_address: to_address,
          
            message: decodedLog.args.message ?? '',
            
            gift_type: 'NFT',              // 'TOKEN' | 'NFT'
            asset_address: decodedLog.args.nft.toLowerCase(),    // null for ETH is also fine; pick one convention
            asset_symbol: decodedLog.args.nftSymbol,
          
            amount_raw: null,
            token_id: decodedLog.args.tokenId?.toString() ?? null,
          };
  
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