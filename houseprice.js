// index.js
require('dotenv').config();
const { createPublicClient, webSocket, formatUnits } = require('viem');
const { apechain } = require('viem/chains');
const { createClient } = require('@supabase/supabase-js');

// --- CONFIGURATION ---
const { APECHAIN_WSS_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

const HOUSE_ADDRESS = "0xB7EcD1F3fA462d2c6c65F55357E8c16c614CC2f1"

// --- ABI DEFINITIONS ---
const houseAbi = [
  {
    type: 'event',
    name: 'PriceChange',
    anonymous: false,
    inputs: [
      { name: 'newPrice', type: 'uint256', indexed: false },
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

// --- EVENT HANDLER ---
const handlePriceChange = async (log) => {
  try {
    console.log(`[PriceChange] Detected event at tx: ${log.transactionHash}`);

    // Price comes directly from the event - no contract read needed
    const price = parseFloat(formatUnits(log.args.newPrice, 18));

    const record = {
      price: price,
      // timestamp: defaults to NOW() on insert, but can override if needed
    };

    console.log('Adding new price record to Supabase:', record);

    const { error } = await supabase
      .from('house_price')
      .insert(record);

    if (error) {
      console.error('[Price Insert] Supabase error:', error);
    } else {
      console.log(`✅ [Price Insert] Added price: ${price}`);
    }
  } catch (e) {
    console.error(`[Event Handler] Failed to process. Error: ${e.message}`);
  }
};

// --- LISTENER: PriceChange Event ---
publicClient.watchContractEvent({
  address: HOUSE_ADDRESS,
  abi: houseAbi,
  eventName: 'PriceChange',
  onLogs: async (logs) => {
    for (const log of logs) {
      await handlePriceChange(log);
    }
  },
  onError: (error) => console.error('[PriceChange] Listener error:', error.message),
});

console.log(`Listening for "PriceChange" events...`);
