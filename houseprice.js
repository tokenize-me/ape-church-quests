// index.js
require('dotenv').config();
const { createPublicClient, webSocket, http, formatUnits } = require('viem'); // Added http if needed, but using webSocket for transport
const { apechain } = require('viem/chains');
const { createClient } = require('@supabase/supabase-js');

// --- CONFIGURATION ---
const { APECHAIN_WSS_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

const HOUSE_ADDRESS = "0x2054709F89F18a4CCAC6132acE7b812E32608469"

// --- ABI DEFINITIONS ---
const houseAbi = [
  {
    type: 'event',
    name: 'HouseWon',
    anonymous: false,
    inputs: [
      { name: 'GAME_ID', type: 'uint256', indexed: false },
      { name: 'profit', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'HouseLost',
    anonymous: false,
    inputs: [
      { name: 'GAME_ID', type: 'uint256', indexed: false },
      { name: 'user', type: 'address', indexed: false },
      { name: 'loss', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'calculatePrice',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
];

// --- CLIENT INITIALIZATION ---
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const publicClient = createPublicClient({
  chain: apechain,
  transport: webSocket(APECHAIN_WSS_URL),
});

console.log('✅ Services Initialized. Starting listeners...');

// --- SHARED HANDLER FOR EVENTS ---
const handleEvent = async (log) => {
  try {
    console.log(`[Event Trigger] Detected event at tx: ${log.transactionHash}`);

    // Read the current price from the contract
    const priceBigInt = await publicClient.readContract({
      address: HOUSE_ADDRESS,
      abi: houseAbi,
      functionName: 'calculatePrice',
    });

    // Parse uint256 to number (use Number for simplicity; if value is large, consider BigInt.toString() and store as text/numeric string)
    const price = parseFloat(formatUnits(priceBigInt, 18));

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

// --- LISTENER: HouseWon and HouseLost Events ---
publicClient.watchContractEvent({
  address: HOUSE_ADDRESS,
  abi: houseAbi,
  eventName: 'HouseWon',
  onLogs: async (logs) => {
    for (const log of logs) {
      await handleEvent(log);
    }
  },
  onError: (error) => console.error('[House Won] Listener error:', error.message),
});

// --- LISTENER: HouseWon and HouseLost Events ---
publicClient.watchContractEvent({
    address: HOUSE_ADDRESS,
    abi: houseAbi,
    eventName: 'HouseLost',
    onLogs: async (logs) => {
      for (const log of logs) {
        await handleEvent(log);
      }
    },
    onError: (error) => console.error('[HouseLost Won] Listener error:', error.message),
  });

console.log(`Listening for "HouseWon" and "HouseLost" events...`);