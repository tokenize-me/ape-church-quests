// crosschain/index.js
//
// CrossChain v2 bridge worker.
//
//   1. Watches `Redeemed(...)` on the ApeChain CrossChainNFT v2 contract over
//      WebSocket, plus a chunked getLogs backfill at startup and every 5 min
//      as a safety net in case the subscription silently dies.
//   2. Every event carries the FULL asset description (chain, assetAddress,
//      assetTokenId, isERC20, amount, data) — no follow-up RPC reads needed.
//   3. The `chain` string selects a handler from the registry in config.js,
//      which performs the actual delivery on the destination chain.
//
// Required env:
//   APECHAIN_WSS_URL        - websocket endpoint for ApeChain (event source)
//   ETH_PRIVATE_KEY         - hex private key of the custody wallet
//
// Optional env:
//   CROSSCHAIN_NFT_ADDRESS  - CrossChainNFT v2 address on ApeChain (defaults
//                             to the production deployment in config.js)
//   ETH_RPC_URL             - Ethereum mainnet JSON-RPC (falls back to the
//                             endpoint v1 had hardcoded)
//   CROSSCHAIN_START_BLOCK  - first ApeChain block to scan when no local state
//                             exists (defaults to current head)
//
// State file: crosschain/state/crosschain-state-<contractAddressLower>.json
//   Records every (txHash, logIndex) already handled, so reconnects, restarts
//   and backfills can never trigger a duplicate delivery.

let config;
try {
  config = require('./config');
} catch (e) {
  console.error(`💥 config error: ${e.message || e}`);
  process.exit(1);
}

const { createPublicClient, webSocket, decodeEventLog } = require('viem');
const { apechain } = require('viem/chains');

const { REDEEMED_ABI, REDEEMED_EVENT } = require('./abi');
const { createState, eventKey } = require('./state');
const { createQueue } = require('./queue');
const { withRetry } = require('./rpc');

const {
  APECHAIN_WSS_URL,
  CROSSCHAIN_NFT_ADDRESS,
  CROSSCHAIN_START_BLOCK,
  STATE_DIR,
  BACKFILL_LOOKBACK_BLOCKS,
  BACKFILL_CHUNK_BLOCKS,
  SAFETY_BACKFILL_INTERVAL,
  MAX_RETRIES,
  RETRY_DELAY_MS,
  handlers,
  getHandler,
  supportedChains,
} = config;

// --- STATE ---------------------------------------------------------------

const state = createState({ contractAddress: CROSSCHAIN_NFT_ADDRESS, dir: STATE_DIR });
console.log(
  `[init] state loaded: ${state.processedCount} processed, lastSeenBlock=${state.lastSeenBlock} (${state.file})`
);

// --- CLIENTS -------------------------------------------------------------

const apechainClient = createPublicClient({
  chain: apechain,
  transport: webSocket(APECHAIN_WSS_URL),
});

// --- QUEUE ---------------------------------------------------------------

// Everything we know about an event, flattened into the state file. BigInts are
// stringified here (JSON cannot hold them) — the state file is also the
// operator's audit log, so it is deliberately verbose.
function baseInfo(item) {
  return {
    tokenId: item.tokenId.toString(),
    recipient: item.recipient,
    chain: item.chain,
    assetAddress: item.assetAddress,
    assetTokenId: item.assetTokenId.toString(),
    isERC20: item.isERC20,
    amount: item.amount.toString(),
    data: item.data,
    apechainTxHash: item.txHash,
    apechainBlock: item.blockNumber != null ? item.blockNumber.toString() : null,
  };
}

async function processEvent(item) {
  const handler = getHandler(item.chain);

  if (!handler) {
    // Loud, but never fatal and never retried: the asset stays in custody and
    // the event can be replayed by deleting its entry from the state file once
    // a handler for this chain is registered.
    console.error(
      `🚨 [dispatch] UNSUPPORTED CHAIN "${item.chain}" for tokenId=${item.tokenId} ` +
        `(apechain tx ${item.txHash}). Known chains: ${supportedChains().join(', ') || '(none)'}. ` +
        `Asset NOT delivered. Add a handler in crosschain/config.js, then delete ` +
        `"${item.key}" from ${state.file} to replay.`
    );
    state.markProcessed(item.key, {
      ...baseInfo(item),
      status: 'unsupported_chain',
      error: `no handler registered for chain "${item.chain}"`,
    });
    return;
  }

  const result = await handler.deliver(item);
  state.markProcessed(item.key, { ...baseInfo(item), ...result });
}

const queue = createQueue({
  isProcessed: (key) => state.isProcessed(key),
  handle: processEvent,
  onTerminalFailure: (item, msg) => {
    state.markProcessed(item.key, { ...baseInfo(item), status: 'failed', error: msg });
  },
  maxRetries: MAX_RETRIES,
  retryDelayMs: RETRY_DELAY_MS,
});

// --- INGEST --------------------------------------------------------------

function handleLog(log) {
  try {
    const decoded = decodeEventLog({
      abi: REDEEMED_ABI,
      data: log.data,
      topics: log.topics,
    });
    const a = decoded.args;
    const key = eventKey(log.transactionHash, log.logIndex);

    queue.enqueue({
      key,
      tokenId: a.tokenId,
      recipient: a.recipient,
      chain: a.chain,
      assetAddress: a.assetAddress,
      assetTokenId: a.assetTokenId,
      isERC20: a.isERC20,
      amount: a.amount,
      data: a.data,
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
      // Re-scan a window before lastSeenBlock so we recover any event that was
      // observed-but-not-yet-completed across a crash. Per-event dedupe makes
      // this safe and idempotent.
      from =
        state.lastSeenBlock > BACKFILL_LOOKBACK_BLOCKS
          ? state.lastSeenBlock - BACKFILL_LOOKBACK_BLOCKS
          : 0n;
    } else if (CROSSCHAIN_START_BLOCK != null) {
      from = BigInt(CROSSCHAIN_START_BLOCK);
    } else {
      from = head;
    }

    if (from > head) return;

    console.log(`[backfill:${label}] scanning ApeChain blocks ${from} → ${head}`);

    let cursor = from;
    let found = 0;
    while (cursor <= head) {
      const end =
        cursor + BACKFILL_CHUNK_BLOCKS - 1n > head ? head : cursor + BACKFILL_CHUNK_BLOCKS - 1n;
      const logs = await withRetry(`apechain.getLogs[${cursor}..${end}]`, () =>
        apechainClient.getLogs({
          address: CROSSCHAIN_NFT_ADDRESS,
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
    state.noteSeenBlock(head);
    console.log(`[backfill:${label}] complete — ${found} log(s) ingested up to block ${head}`);
  } catch (e) {
    console.error(`[backfill:${label}] failed:`, e.shortMessage || e.message || e);
  }
}

// --- MAIN ----------------------------------------------------------------

let unwatch = null;
let safetyTimer = null;

async function main() {
  console.log('🚀 crosschain v2 worker starting up');
  console.log(`📇 registry: ${supportedChains().join(', ') || '(none registered!)'}`);

  if (handlers.size === 0) {
    throw new Error('no chain handlers registered — nothing could ever be delivered');
  }

  // Per-chain boot sanity: chainId must match (fatal), balance is informational.
  for (const handler of handlers.values()) {
    await handler.init();
  }

  const apechainHead = await withRetry('apechain.getBlockNumber', () =>
    apechainClient.getBlockNumber()
  );
  console.log(`🦍 ApeChain head: block ${apechainHead}`);

  await backfill('startup');

  unwatch = apechainClient.watchContractEvent({
    address: CROSSCHAIN_NFT_ADDRESS,
    abi: REDEEMED_ABI,
    eventName: 'Redeemed',
    onLogs: (logs) => {
      for (const log of logs) {
        console.log(
          `[Redeemed] live block=${log.blockNumber} tx=${log.transactionHash} idx=${log.logIndex}`
        );
        handleLog(log);
        state.noteSeenBlock(log.blockNumber);
      }
    },
    onError: (err) => console.error('[Redeemed] watcher error:', err.message || err),
  });
  console.log(`👂 watching ApeChain ${CROSSCHAIN_NFT_ADDRESS} for Redeemed`);

  // Safety net: even if the WSS subscription silently dies, this catches us up.
  safetyTimer = setInterval(() => {
    backfill('safety').catch((e) => console.error('[backfill:safety] interval err', e));
  }, SAFETY_BACKFILL_INTERVAL);
}

// --- GRACEFUL SHUTDOWN ---------------------------------------------------

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n🛑 ${signal} received; finishing current work then exiting.`);

  if (safetyTimer) clearInterval(safetyTimer);
  if (typeof unwatch === 'function') {
    try {
      unwatch();
    } catch {
      /* ignore */
    }
  }

  const wait = () => {
    if (queue.isIdle()) {
      if (queue.pendingRetries > 0) {
        console.warn(
          `⚠️  ${queue.pendingRetries} item(s) had a retry scheduled and will be picked ` +
            `up by the startup backfill on next boot.`
        );
      }
      console.log('👋 clean shutdown');
      process.exit(0);
    } else {
      setTimeout(wait, 500);
    }
  };
  wait();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((e) => {
  console.error('💥 fatal:', e);
  process.exit(1);
});
