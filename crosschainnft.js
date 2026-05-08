// crosschainnft.js
//
// Cross-chain NFT bridge worker:
//   1. Listens for `Redeemed(uint256 indexed tokenId, address indexed recipient)`
//      on the ApeChain CrossChainNFT contract via WebSocket.
//   2. On each event, calls `transferFrom(signerWallet, recipient, tokenId)` on
//      the Ethereum mainnet NFT contract from the configured private-key wallet.
//
// Required env vars:
//   APECHAIN_WSS_URL        - websocket endpoint for ApeChain (event source)
//   ETH_RPC_URL             - JSON-RPC endpoint for Ethereum mainnet
//   ETH_PRIVATE_KEY         - hex private key of the wallet that holds the ETH NFTs
//
// Optional env vars:
//   CROSSCHAIN_START_BLOCK  - first ApeChain block to scan when no local state exists
//                             (defaults to current head — older history is ignored)
//
// State file: ./crosschainnft-state.json
//   - Records every (txHash, logIndex) we've already handled, so reconnects /
//     restarts / safety-net backfills never trigger a duplicate transfer.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  createPublicClient,
  webSocket,
  decodeEventLog,
  parseAbiItem,
} = require('viem');
const { apechain } = require('viem/chains');
const { ethers } = require('ethers');

// --- ENV ---
const {
  APECHAIN_WSS_URL,
  ETH_PRIVATE_KEY
} = process.env;

if (!APECHAIN_WSS_URL) throw new Error('Missing APECHAIN_WSS_URL');
if (!ETH_PRIVATE_KEY)  throw new Error('Missing ETH_PRIVATE_KEY');

// --- CONTRACTS ---
const APECHAIN_NFT_ADDRESS = '0xe8d4580880959d9E5de63f3f2531C1E1565D821D';
const ETH_NFT_ADDRESS      = '0x4dE566Ac60e83015156CfD5C180f4bcAD320A56d';
const ETH_RPC_URL = "https://eth-mainnet.g.alchemy.com/v2/bcMih1Lc3XtkmIJEAGzsp";
const CROSSCHAIN_START_BLOCK = 37711430;

// --- TUNABLES ---
const STATE_FILE                = path.join(__dirname, 'crosschainnft-state.json');
const BACKFILL_LOOKBACK_BLOCKS  = 100_000n;        // ~2.3 days on ApeChain (2s blocks)
const BACKFILL_CHUNK_BLOCKS     = 5_000n;
const SAFETY_BACKFILL_INTERVAL  = 5 * 60 * 1000;   // 5 minutes
const ETH_CONFIRMATIONS         = 1;
const ETH_TX_TIMEOUT_MS         = 5 * 60 * 1000;   // 5 minutes
const GAS_BUMP_NUMERATOR        = 150n;            // 1.5x EIP-1559 fees
const GAS_BUMP_DENOMINATOR      = 100n;
const GAS_LIMIT_BUFFER_NUM      = 150n;            // 1.5x estimated gas
const GAS_LIMIT_BUFFER_DEN      = 100n;
const MAX_RETRIES               = 1;
const RETRY_DELAY_MS            = 30 * 1000;
const ETH_MAINNET_CHAIN_ID      = 1n;
const LOW_BALANCE_THRESHOLD     = ethers.parseEther('0.01');

// RPC retry settings — covers transient 429s / timeouts / network blips on
// individual read calls. Backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped).
const RPC_MAX_ATTEMPTS          = 6;
const RPC_BACKOFF_BASE_MS       = 1000;
const RPC_BACKOFF_CAP_MS        = 30 * 1000;

// --- ABIs ---
// Used by viem.watchContractEvent / decodeEventLog (object form).
const REDEEMED_ABI = [
  {
    type: 'event',
    name: 'Redeemed',
    anonymous: false,
    inputs: [
      { name: 'tokenId',   type: 'uint256', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
    ],
  },
];
// Used by viem.getLogs (single AbiItem form).
const REDEEMED_EVENT = parseAbiItem(
  'event Redeemed(uint256 indexed tokenId, address indexed recipient)'
);

const ERC721_ABI = [
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
];

// --- STATE (durable, JSON on disk) ---
function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      processed: parsed.processed || {},
      lastSeenBlock: parsed.lastSeenBlock != null ? BigInt(parsed.lastSeenBlock) : null,
    };
  } catch {
    return { processed: {}, lastSeenBlock: null };
  }
}

function saveState() {
  const out = {
    processed: state.processed,
    lastSeenBlock: state.lastSeenBlock != null ? state.lastSeenBlock.toString() : null,
  };
  // Atomic write: write to temp then rename so a mid-write crash never corrupts state.
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

const state = loadState();
console.log(
  `[init] state loaded: ${Object.keys(state.processed).length} processed, lastSeenBlock=${state.lastSeenBlock}`
);

function eventKey(txHash, logIndex) {
  return `${txHash.toLowerCase()}:${Number(logIndex)}`;
}

function isProcessed(key) {
  return Boolean(state.processed[key]);
}

function markProcessed(key, info) {
  state.processed[key] = { ...info, processedAt: new Date().toISOString() };
  saveState();
}

function noteSeenBlock(blockNumber) {
  if (blockNumber == null) return;
  const blk = BigInt(blockNumber);
  if (state.lastSeenBlock == null || blk > state.lastSeenBlock) {
    state.lastSeenBlock = blk;
    saveState();
  }
}

// --- CLIENTS ---
const apechainClient = createPublicClient({
  chain: apechain,
  transport: webSocket(APECHAIN_WSS_URL),
});

const ethProvider = new ethers.JsonRpcProvider(ETH_RPC_URL);
const ethWallet   = new ethers.Wallet(ETH_PRIVATE_KEY, ethProvider);
const ethNft      = new ethers.Contract(ETH_NFT_ADDRESS, ERC721_ABI, ethWallet);

// --- TRANSFER QUEUE (sequential — nonce-safe and RPC-friendly) ---
const queue = [];
const enqueuedKeys = new Set();
let processing = false;

function enqueue(item) {
  if (isProcessed(item.key)) return;
  if (enqueuedKeys.has(item.key)) return;
  enqueuedKeys.add(item.key);
  queue.push(item);
  if (!processing) {
    runQueue().catch((e) => console.error('[queue] runQueue threw:', e));
  }
}

async function runQueue() {
  processing = true;
  try {
    while (queue.length > 0) {
      const item = queue.shift();
      if (isProcessed(item.key)) {
        enqueuedKeys.delete(item.key);
        continue;
      }
      try {
        await processTransfer(item);
        enqueuedKeys.delete(item.key);
      } catch (e) {
        const msg = e.shortMessage || e.message || String(e);
        const attempt = (item.retries ?? 0) + 1;
        console.error(`[queue] item ${item.key} failed (attempt ${attempt}): ${msg}`);

        enqueuedKeys.delete(item.key);
        if (attempt <= MAX_RETRIES) {
          const next = { ...item, retries: attempt };
          setTimeout(() => enqueue(next), RETRY_DELAY_MS);
        } else {
          markProcessed(item.key, {
            tokenId: item.tokenId.toString(),
            recipient: item.recipient,
            apechainTxHash: item.txHash,
            status: 'failed',
            error: msg,
          });
          console.error(`[queue] giving up on ${item.key}; failure recorded to state file`);
        }
      }
    }
  } finally {
    processing = false;
  }
}

async function processTransfer({ tokenId, recipient, key, blockNumber, txHash }) {
  console.log(`[transfer] tokenId=${tokenId} → ${recipient} (apechain tx ${txHash})`);

  if (!recipient || recipient === ethers.ZeroAddress) {
    console.warn(`[transfer] skip: zero/empty recipient`);
    markProcessed(key, {
      tokenId: tokenId.toString(),
      recipient,
      status: 'skipped_zero_recipient',
      apechainTxHash: txHash,
    });
    return;
  }

  // Idempotency guard: if a previous attempt already transferred (or someone else
  // moved the token), ownerOf will not return our address and we abort cleanly.
  // Because tokenIds are unique, this also makes double-spend structurally
  // impossible across reconnects, retries, and backfills.
  const owner = await withRetry(`ownerOf(${tokenId})`, () => ethNft.ownerOf(tokenId));
  if (owner.toLowerCase() !== ethWallet.address.toLowerCase()) {
    console.warn(`[transfer] skip: tokenId=${tokenId} owned by ${owner}, not us`);
    markProcessed(key, {
      tokenId: tokenId.toString(),
      recipient,
      status: 'not_owned',
      owner,
      apechainTxHash: txHash,
    });
    return;
  }

  // Build fee overrides — bump 50% so we land in a block reliably.
  const feeData = await withRetry('getFeeData', () => ethProvider.getFeeData());
  const overrides = {};
  if (feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null) {
    overrides.maxPriorityFeePerGas =
      (feeData.maxPriorityFeePerGas * GAS_BUMP_NUMERATOR) / GAS_BUMP_DENOMINATOR;
    overrides.maxFeePerGas =
      (feeData.maxFeePerGas * GAS_BUMP_NUMERATOR) / GAS_BUMP_DENOMINATOR;
    console.log(
      `[transfer] fee bump: maxFee=${ethers.formatUnits(overrides.maxFeePerGas, 'gwei')} gwei ` +
      `prio=${ethers.formatUnits(overrides.maxPriorityFeePerGas, 'gwei')} gwei`
    );
  } else if (feeData.gasPrice != null) {
    overrides.gasPrice = (feeData.gasPrice * GAS_BUMP_NUMERATOR) / GAS_BUMP_DENOMINATOR;
    console.log(`[transfer] fee bump: gasPrice=${ethers.formatUnits(overrides.gasPrice, 'gwei')} gwei`);
  } else {
    throw new Error('No fee data returned from ETH provider');
  }

  // Gas limit with 50% buffer.
  const gasEstimate = await withRetry(
    `estimateGas transferFrom(${tokenId})`,
    () => ethNft.transferFrom.estimateGas(ethWallet.address, recipient, tokenId)
  );
  overrides.gasLimit = (gasEstimate * GAS_LIMIT_BUFFER_NUM) / GAS_LIMIT_BUFFER_DEN;
  console.log(`[transfer] gasLimit=${overrides.gasLimit} (estimated ${gasEstimate})`);

  const tx = await ethNft.transferFrom(
    ethWallet.address, recipient, tokenId, overrides
  );
  console.log(`[transfer] sent ETH tx ${tx.hash}; awaiting ${ETH_CONFIRMATIONS} conf(s)...`);

  const receipt = await waitWithTimeout(
    tx.wait(ETH_CONFIRMATIONS),
    ETH_TX_TIMEOUT_MS,
    `tx ${tx.hash}`
  );
  if (!receipt || receipt.status !== 1) {
    throw new Error(`tx ${tx.hash} did not succeed (status=${receipt?.status})`);
  }

  console.log(
    `✅ [transfer] tokenId=${tokenId} → ${recipient} mined block=${receipt.blockNumber} ` +
    `tx=${tx.hash} gasUsed=${receipt.gasUsed}`
  );
  markProcessed(key, {
    tokenId: tokenId.toString(),
    recipient,
    status: 'transferred',
    ethTxHash: tx.hash,
    ethBlock: Number(receipt.blockNumber),
    apechainTxHash: txHash,
    apechainBlock: blockNumber != null ? blockNumber.toString() : null,
  });
}

function waitWithTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Crude retry for read-side RPC calls. Identifies common transient failures
// (429s, timeouts, ECONNRESET, etc.) and backs off exponentially. We do NOT
// use this for sendTransaction — that path is handled by the queue's own
// retry policy and the ownerOf idempotency check.
function isTransientRpcError(err) {
  if (!err) return false;
  const code = err.code ?? err.error?.code;
  if (code === 429 || code === -32005) return true; // rate-limited
  if (code === 'TIMEOUT' || code === 'NETWORK_ERROR' || code === 'SERVER_ERROR') return true;
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') return true;
  const msg = (err.shortMessage || err.message || '').toLowerCase();
  return (
    msg.includes('rate') ||
    msg.includes('429') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('failed to fetch') ||
    msg.includes('bad gateway') ||
    msg.includes('service unavailable')
  );
}

async function withRetry(label, fn) {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (e) {
      const transient = isTransientRpcError(e);
      const msg = e.shortMessage || e.message || String(e);
      if (!transient || attempt >= RPC_MAX_ATTEMPTS) {
        throw e;
      }
      const delay = Math.min(RPC_BACKOFF_CAP_MS, RPC_BACKOFF_BASE_MS * 2 ** (attempt - 1));
      console.warn(`[rpc] ${label} transient failure (attempt ${attempt}/${RPC_MAX_ATTEMPTS}): ${msg} — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

// --- INGEST ---
function handleLog(log) {
  try {
    const decoded = decodeEventLog({
      abi: REDEEMED_ABI,
      data: log.data,
      topics: log.topics,
    });
    const tokenId = decoded.args.tokenId;
    const recipient = decoded.args.recipient.toLowerCase();
    const key = eventKey(log.transactionHash, log.logIndex);

    enqueue({
      tokenId,
      recipient,
      key,
      blockNumber: log.blockNumber,
      txHash: log.transactionHash.toLowerCase(),
    });
  } catch (e) {
    console.error('[Redeemed] failed to handle log:', e.message || e);
  }
}

async function backfill(label = 'startup') {
  try {
    const head = await withRetry('apechain.getBlockNumber', () => apechainClient.getBlockNumber());

    let from;
    if (state.lastSeenBlock != null) {
      // Re-scan a window before lastSeenBlock so we recover from any events
      // that were observed-but-not-yet-completed across a crash. The per-event
      // dedupe (state.processed) makes this safe and idempotent.
      from = state.lastSeenBlock > BACKFILL_LOOKBACK_BLOCKS
        ? state.lastSeenBlock - BACKFILL_LOOKBACK_BLOCKS
        : 0n;
    } else if (CROSSCHAIN_START_BLOCK) {
      from = BigInt(CROSSCHAIN_START_BLOCK);
    } else {
      from = head;
    }

    if (from > head) return;

    console.log(`[backfill:${label}] scanning ApeChain blocks ${from} → ${head}`);

    let cursor = from;
    let found = 0;
    while (cursor <= head) {
      const end = (cursor + BACKFILL_CHUNK_BLOCKS - 1n) > head
        ? head
        : (cursor + BACKFILL_CHUNK_BLOCKS - 1n);
      const logs = await withRetry(
        `apechain.getLogs[${cursor}..${end}]`,
        () => apechainClient.getLogs({
          address: APECHAIN_NFT_ADDRESS,
          event: REDEEMED_EVENT,
          fromBlock: cursor,
          toBlock: end,
        })
      );
      for (const log of logs) {
        handleLog(log);
        found++;
      }
      cursor = end + 1n;
    }
    noteSeenBlock(head);
    console.log(`[backfill:${label}] complete — ${found} log(s) ingested up to block ${head}`);
  } catch (e) {
    console.error(`[backfill:${label}] failed:`, e.shortMessage || e.message || e);
  }
}

// --- MAIN ---
async function main() {
  console.log('🚀 crosschainnft starting up');

  // Sanity: make sure ETH RPC actually points at mainnet — wrong-network config
  // is the easiest way to fat-finger this kind of bridge worker.
  const ethNet = await withRetry('eth.getNetwork', () => ethProvider.getNetwork());
  if (ethNet.chainId !== ETH_MAINNET_CHAIN_ID) {
    throw new Error(
      `ETH_RPC_URL is on chainId=${ethNet.chainId}, expected ${ETH_MAINNET_CHAIN_ID} (mainnet)`
    );
  }

  // Balance check is informational — never fatal. A flaky/throttled RPC at boot
  // shouldn't take the bot offline; an actual "insufficient funds" will surface
  // at transfer time and be handled by the queue's retry policy.
  try {
    const ethBalance = await withRetry(
      'eth.getBalance',
      () => ethProvider.getBalance(ethWallet.address)
    );
    console.log(`👤 ETH wallet ${ethWallet.address} balance ${ethers.formatEther(ethBalance)} ETH`);
    if (ethBalance < LOW_BALANCE_THRESHOLD) {
      console.warn('⚠️  ETH balance is low. Top up before transfers will go out.');
    }
  } catch (e) {
    console.warn(
      `⚠️  Could not read ETH balance for ${ethWallet.address} ` +
      `(${e.shortMessage || e.message || e}). Continuing — if your RPC is ` +
      `rate-limiting on boot, switch to a dedicated endpoint (Alchemy/Infura/Quicknode).`
    );
  }

  const apechainHead = await withRetry(
    'apechain.getBlockNumber',
    () => apechainClient.getBlockNumber()
  );
  console.log(`🦍 ApeChain head: block ${apechainHead}`);

  await backfill('startup');

  apechainClient.watchContractEvent({
    address: APECHAIN_NFT_ADDRESS,
    abi: REDEEMED_ABI,
    eventName: 'Redeemed',
    onLogs: (logs) => {
      for (const log of logs) {
        console.log(
          `[Redeemed] live block=${log.blockNumber} tx=${log.transactionHash} idx=${log.logIndex}`
        );
        handleLog(log);
        noteSeenBlock(log.blockNumber);
      }
    },
    onError: (err) => console.error('[Redeemed] watcher error:', err.message || err),
  });
  console.log(`👂 watching ApeChain ${APECHAIN_NFT_ADDRESS} for Redeemed`);

  // Safety net: even if the WSS subscription silently dies, this catches us up.
  setInterval(() => {
    backfill('safety').catch((e) => console.error('[backfill:safety] interval err', e));
  }, SAFETY_BACKFILL_INTERVAL);
}

// --- GRACEFUL SHUTDOWN ---
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n🛑 ${signal} received; finishing current work then exiting.`);
  const wait = () => {
    if (!processing && queue.length === 0) {
      console.log('👋 clean shutdown');
      process.exit(0);
    } else {
      setTimeout(wait, 500);
    }
  };
  wait();
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((e) => {
  console.error('💥 fatal:', e);
  process.exit(1);
});
