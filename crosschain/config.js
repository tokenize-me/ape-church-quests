// crosschain/config.js
//
// Env loading + validation, tunables, and the chain handler REGISTRY.
//
// The registry is the whole extension story:
//   - another EVM chain  -> add an entry to EVM_CHAINS below (its own RPC URL,
//                           private key, expected chainId, confirmations). No
//                           code changes anywhere else.
//   - a non-EVM chain    -> add crosschain/chains/<foo>.js exporting the same
//                           handler contract, then register it here.
//
// Nothing outside this file knows which chains exist.

require('dotenv').config();

const path = require('path');
const { ethers } = require('ethers');
const { createEvmHandler } = require('./chains/evm');

// --- ENV -----------------------------------------------------------------

const {
  APECHAIN_WSS_URL,
  ETH_PRIVATE_KEY,
  CROSSCHAIN_NFT_ADDRESS,
  ETH_RPC_URL,
  CROSSCHAIN_START_BLOCK,
} = process.env;

function requireEnv(name, value, hint) {
  if (!value || String(value).trim() === '') {
    throw new Error(`Missing required env var ${name}${hint ? ` — ${hint}` : ''}`);
  }
  return String(value).trim();
}

const wssUrl = requireEnv(
  'APECHAIN_WSS_URL',
  APECHAIN_WSS_URL,
  'websocket endpoint for ApeChain (the Redeemed event source)'
);

const ethPrivateKey = requireEnv(
  'ETH_PRIVATE_KEY',
  ETH_PRIVATE_KEY,
  'hex private key of the custody wallet holding the remote assets'
);

// Deployed CrossChainNFT v2 on ApeChain. CROSSCHAIN_NFT_ADDRESS overrides
// (useful for pointing a dev box at a test deployment).
const DEFAULT_CROSSCHAIN_NFT_ADDRESS = '0x26c8F051acF2d898a0055Ed85c19a845Bcc5bE0F';

const rawContract =
  CROSSCHAIN_NFT_ADDRESS && String(CROSSCHAIN_NFT_ADDRESS).trim() !== ''
    ? String(CROSSCHAIN_NFT_ADDRESS).trim()
    : DEFAULT_CROSSCHAIN_NFT_ADDRESS;

let watchedContract;
try {
  watchedContract = ethers.getAddress(rawContract);
} catch {
  throw new Error(`CROSSCHAIN_NFT_ADDRESS is not a valid address: ${rawContract}`);
}

let startBlock = null;
if (CROSSCHAIN_START_BLOCK && String(CROSSCHAIN_START_BLOCK).trim() !== '') {
  try {
    startBlock = BigInt(String(CROSSCHAIN_START_BLOCK).trim());
  } catch {
    throw new Error(`CROSSCHAIN_START_BLOCK is not an integer: ${CROSSCHAIN_START_BLOCK}`);
  }
}

// v1's hardcoded endpoint, kept as the fallback so an existing droplet that
// never set ETH_RPC_URL keeps working after the upgrade.
const DEFAULT_ETH_RPC_URL = 'https://eth-mainnet.g.alchemy.com/v2/bcMih1Lc3XtkmIJEAGzsp';

// --- TUNABLES (v1 values, unchanged) -------------------------------------

const STATE_DIR = path.join(__dirname, 'state');
const BACKFILL_LOOKBACK_BLOCKS = 100_000n; // ~2.3 days on ApeChain (2s blocks)
const BACKFILL_CHUNK_BLOCKS = 5_000n;
const SAFETY_BACKFILL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 30 * 1000;

// Per-transaction knobs handed to every EVM handler.
const EVM_TX_DEFAULTS = {
  gasBumpNumerator: 150n, // 1.5x EIP-1559 fees (or legacy gasPrice)
  gasBumpDenominator: 100n,
  gasLimitBufferNumerator: 150n, // 1.5x estimated gas
  gasLimitBufferDenominator: 100n,
  timeoutMs: 5 * 60 * 1000, // 5 minutes
};

// --- CHAIN REGISTRY ------------------------------------------------------
//
// Each entry is fully self-contained: its own RPC, its own key, its own
// expected chainId, its own confirmation count. Copy an entry to add a chain.
//
//   {
//     chain: 'eip155:8453',
//     name: 'Base',
//     rpcUrl: process.env.BASE_RPC_URL,
//     privateKey: process.env.BASE_PRIVATE_KEY || ethPrivateKey,
//     expectedChainId: 8453n,
//     confirmations: 1,
//     nativeSymbol: 'ETH',
//     lowBalanceThreshold: ethers.parseEther('0.005'),
//   }

const EVM_CHAINS = [
  {
    chain: 'eip155:1',
    name: 'Ethereum mainnet',
    rpcUrl: ETH_RPC_URL && ETH_RPC_URL.trim() !== '' ? ETH_RPC_URL.trim() : DEFAULT_ETH_RPC_URL,
    privateKey: ethPrivateKey,
    expectedChainId: 1n,
    confirmations: 1,
    nativeSymbol: 'ETH',
    lowBalanceThreshold: ethers.parseEther('0.01'),
  },
];

const handlers = new Map();
for (const entry of EVM_CHAINS) {
  if (handlers.has(entry.chain)) {
    throw new Error(`[config] duplicate chain registration: ${entry.chain}`);
  }
  handlers.set(entry.chain, createEvmHandler({ ...entry, tx: EVM_TX_DEFAULTS }));
}

// Future non-EVM handlers register here the same way, e.g.
//   const { createSolanaHandler } = require('./chains/solana');
//   handlers.set('solana:mainnet', createSolanaHandler({ ... }));

function getHandler(chain) {
  if (typeof chain !== 'string') return undefined;
  return handlers.get(chain);
}

function supportedChains() {
  return Array.from(handlers.keys());
}

module.exports = {
  // env
  APECHAIN_WSS_URL: wssUrl,
  CROSSCHAIN_NFT_ADDRESS: watchedContract,
  CROSSCHAIN_START_BLOCK: startBlock,
  DEFAULT_ETH_RPC_URL,

  // tunables
  STATE_DIR,
  BACKFILL_LOOKBACK_BLOCKS,
  BACKFILL_CHUNK_BLOCKS,
  SAFETY_BACKFILL_INTERVAL,
  MAX_RETRIES,
  RETRY_DELAY_MS,
  EVM_TX_DEFAULTS,

  // registry
  handlers,
  getHandler,
  supportedChains,
};
