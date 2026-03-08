require('dotenv').config();

const { ethers } = require('ethers');
const { createPublicClient, webSocket, decodeEventLog } = require('viem');
const { apechain } = require('viem/chains');

const {
  APECHAIN_RPC_URL,
  APECHAIN_WSS_URL,
  PRIVATE_KEY,
  GAME_CONTRACT_ADDRESS,
} = process.env;

const GAME_PROCESSOR_ABI = [
  {
    type: 'event',
    name: 'RandomnessReturned',
    anonymous: false,
    inputs: [{ name: 'gameId', type: 'uint256', indexed: true }],
  },
  {
    type: 'function',
    name: 'resolveGame',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getGameIDsWaitingToBeResolved',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'batchResolveGame',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'gameIds', type: 'uint256[]' }],
    outputs: [],
  },
];

const POLL_INTERVAL_MS = 10_000;
const PRIORITY_FEE_BUMP_GWEI = '4';
const SINGLE_GAS_BUFFER_PERCENT = 110n;
const BATCH_GAS_BUFFER_PERCENT = 110n;
const ATTEMPT_COOLDOWN_MS = 30_000;
const STALE_IN_FLIGHT_MS = 120_000;

if (!APECHAIN_RPC_URL || !APECHAIN_WSS_URL || !PRIVATE_KEY || !GAME_CONTRACT_ADDRESS) {
  console.error('Missing required environment variables. Expected APECHAIN_RPC_URL, APECHAIN_WSS_URL, PRIVATE_KEY, and GAME_CONTRACT_ADDRESS.');
  process.exit(1);
}

const publicClient = createPublicClient({
  chain: apechain,
  transport: webSocket(APECHAIN_WSS_URL),
});

const provider = new ethers.JsonRpcProvider(APECHAIN_RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const signer = new ethers.NonceManager(wallet);
const contract = new ethers.Contract(GAME_CONTRACT_ADDRESS, GAME_PROCESSOR_ABI, signer);

const inFlightGames = new Map();
const recentAttempts = new Map();

let pollingInProgress = false;
let stopWatching = null;
let pollIntervalHandle = null;

function now() {
  return Date.now();
}

function getErrorMessage(error) {
  return error?.shortMessage || error?.reason || error?.message || String(error);
}

function toGameIdKey(gameId) {
  return gameId.toString();
}

function clearExpiredState() {
  const currentTime = now();

  for (const [gameId, startedAt] of inFlightGames.entries()) {
    if (currentTime - startedAt > STALE_IN_FLIGHT_MS) {
      console.warn(`[State] Clearing stale in-flight marker for game ${gameId}.`);
      inFlightGames.delete(gameId);
    }
  }

  for (const [gameId, attemptedAt] of recentAttempts.entries()) {
    if (currentTime - attemptedAt > ATTEMPT_COOLDOWN_MS) {
      recentAttempts.delete(gameId);
    }
  }
}

function isInFlight(gameId) {
  const startedAt = inFlightGames.get(gameId);
  return typeof startedAt === 'number' && now() - startedAt <= STALE_IN_FLIGHT_MS;
}

function wasAttemptedRecently(gameId) {
  const attemptedAt = recentAttempts.get(gameId);
  return typeof attemptedAt === 'number' && now() - attemptedAt <= ATTEMPT_COOLDOWN_MS;
}

function markInFlight(gameId) {
  inFlightGames.set(gameId, now());
}

function clearInFlight(gameId) {
  inFlightGames.delete(gameId);
}

function markRecentAttempt(gameId) {
  recentAttempts.set(gameId, now());
}

function isExpectedRaceError(error) {
  const message = getErrorMessage(error).toLowerCase();

  return (
    error?.code === 'CALL_EXCEPTION' ||
    message.includes('execution reverted') ||
    message.includes('already') ||
    message.includes('resolved') ||
    message.includes('missing revert data')
  );
}

async function getFeeOverrides() {
  const feeData = await contract.runner.provider.getFeeData();
  const priorityBase = feeData.maxPriorityFeePerGas ?? ethers.parseUnits('1', 'gwei');
  const maxFeeBase =
    feeData.maxFeePerGas ??
    (feeData.gasPrice ? feeData.gasPrice + priorityBase : ethers.parseUnits('25', 'gwei'));
  const priorityBump = ethers.parseUnits(PRIORITY_FEE_BUMP_GWEI, 'gwei');

  return {
    maxPriorityFeePerGas: priorityBase + priorityBump,
    maxFeePerGas: maxFeeBase + priorityBump,
  };
}

function addGasBuffer(gasEstimate, bufferPercent) {
  return (gasEstimate * bufferPercent) / 100n;
}

async function monitorTransaction(tx, label, gameIds) {
  try {
    const receipt = await tx.wait();
    console.log(`[${label}] Tx mined in block ${receipt.blockNumber}: ${tx.hash}`);
  } catch (error) {
    console.warn(`[${label}] Tx monitoring error for ${tx.hash}: ${getErrorMessage(error)}`);
  } finally {
    for (const gameId of gameIds) {
      clearInFlight(gameId);
      markRecentAttempt(gameId);
    }
  }
}

async function resolveSingleGame(gameId, source) {
  const gameIdKey = toGameIdKey(gameId);

  if (isInFlight(gameIdKey)) {
    console.log(`[${source}] Game ${gameIdKey} is already in flight, skipping duplicate attempt.`);
    return;
  }

  if (wasAttemptedRecently(gameIdKey)) {
    console.log(`[${source}] Game ${gameIdKey} was attempted recently, skipping duplicate attempt.`);
    return;
  }

  markInFlight(gameIdKey);

  try {
    const feeOverrides = await getFeeOverrides();
    const gasEstimate = await contract.resolveGame.estimateGas(gameId);
    const gasLimit = addGasBuffer(gasEstimate, SINGLE_GAS_BUFFER_PERCENT);

    console.log(`[${source}] Resolving game ${gameIdKey}...`);

    const tx = await contract.resolveGame(gameId, {
      gasLimit,
      maxPriorityFeePerGas: feeOverrides.maxPriorityFeePerGas,
      maxFeePerGas: feeOverrides.maxFeePerGas,
    });

    console.log(`[${source}] resolveGame submitted for ${gameIdKey}: ${tx.hash}`);
    void monitorTransaction(tx, `${source}:resolveGame`, [gameIdKey]);
  } catch (error) {
    clearInFlight(gameIdKey);

    if (isExpectedRaceError(error)) {
      markRecentAttempt(gameIdKey);
      console.warn(`[${source}] resolveGame skipped for ${gameIdKey}: ${getErrorMessage(error)}`);
      return;
    }

    console.error(`[${source}] resolveGame failed for ${gameIdKey}: ${getErrorMessage(error)}`);
  }
}

async function batchResolveGames(gameIds, source) {
  const gameIdKeys = gameIds.map(toGameIdKey);
  const eligibleGameIds = [];

  for (const gameIdKey of gameIdKeys) {
    if (isInFlight(gameIdKey) || wasAttemptedRecently(gameIdKey)) {
      continue;
    }

    eligibleGameIds.push(gameIdKey);
  }

  if (eligibleGameIds.length === 0) {
    return;
  }

  if (eligibleGameIds.length === 1) {
    await resolveSingleGame(eligibleGameIds[0], `${source}:single-fallback`);
    return;
  }

  for (const gameIdKey of eligibleGameIds) {
    markInFlight(gameIdKey);
  }

  try {
    const feeOverrides = await getFeeOverrides();
    const gasEstimate = await contract.batchResolveGame.estimateGas(eligibleGameIds);
    const gasLimit = addGasBuffer(gasEstimate, BATCH_GAS_BUFFER_PERCENT);

    console.log(`[${source}] Batch resolving ${eligibleGameIds.length} game(s): ${eligibleGameIds.join(', ')}`);

    const tx = await contract.batchResolveGame(eligibleGameIds, {
      gasLimit,
      maxPriorityFeePerGas: feeOverrides.maxPriorityFeePerGas,
      maxFeePerGas: feeOverrides.maxFeePerGas,
    });

    console.log(`[${source}] batchResolveGame submitted: ${tx.hash}`);
    void monitorTransaction(tx, `${source}:batchResolveGame`, eligibleGameIds);
  } catch (error) {
    for (const gameIdKey of eligibleGameIds) {
      clearInFlight(gameIdKey);
    }

    if (isExpectedRaceError(error)) {
      console.warn(`[${source}] batchResolveGame raced another bot, retrying individually.`);

      for (const gameIdKey of eligibleGameIds) {
        void resolveSingleGame(gameIdKey, `${source}:fallback`);
      }
      return;
    }

    console.error(`[${source}] batchResolveGame failed: ${getErrorMessage(error)}`);
  }
}

async function pollForMissedGames() {
  if (pollingInProgress) {
    console.log('[poll] Previous poll still running, skipping this interval.');
    return;
  }

  pollingInProgress = true;
  clearExpiredState();

  try {
    const pendingGameIds = await contract.getGameIDsWaitingToBeResolved();
    const normalizedGameIds = pendingGameIds.map((gameId) => toGameIdKey(gameId));

    if (normalizedGameIds.length === 0) {
      console.log('[poll] No pending games to resolve.');
      return;
    }

    console.log(`[poll] Found ${normalizedGameIds.length} pending game(s).`);
    await batchResolveGames(normalizedGameIds, 'poll');
  } catch (error) {
    console.error(`[poll] Failed to read pending games: ${getErrorMessage(error)}`);
  } finally {
    pollingInProgress = false;
  }
}

async function startListener() {
  console.log(`Listening for RandomnessReturned on ${GAME_CONTRACT_ADDRESS}...`);

  stopWatching = publicClient.watchContractEvent({
    address: GAME_CONTRACT_ADDRESS,
    abi: GAME_PROCESSOR_ABI,
    eventName: 'RandomnessReturned',
    onLogs: async (logs) => {
      clearExpiredState();

      for (const log of logs) {
        try {
          const decodedLog = decodeEventLog({
            abi: GAME_PROCESSOR_ABI,
            data: log.data,
            topics: log.topics,
          });

          const gameId = decodedLog.args.gameId.toString();
          console.log(`[event] RandomnessReturned detected for game ${gameId} in tx ${log.transactionHash}`);
          void resolveSingleGame(gameId, 'event');
        } catch (error) {
          console.error(`[event] Failed to decode or process log: ${getErrorMessage(error)}`);
        }
      }
    },
    onError: (error) => {
      console.error(`[event] Listener error: ${getErrorMessage(error)}`);
    },
  });
}

function setupShutdownHandlers() {
  const shutdown = async (signal) => {
    console.log(`Received ${signal}. Shutting down game processor...`);

    if (pollIntervalHandle) {
      clearInterval(pollIntervalHandle);
      pollIntervalHandle = null;
    }

    if (stopWatching) {
      stopWatching();
      stopWatching = null;
    }

    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

async function main() {
  console.log('Starting game processor...');
  console.log(`Wallet loaded: ${wallet.address}`);
  console.log(`Polling every ${POLL_INTERVAL_MS / 1000} seconds for missed game resolutions.`);

  await startListener();
  setupShutdownHandlers();

  await pollForMissedGames();
  pollIntervalHandle = setInterval(() => {
    void pollForMissedGames();
  }, POLL_INTERVAL_MS);
}

main().catch((error) => {
  console.error(`Fatal startup error: ${getErrorMessage(error)}`);
  process.exit(1);
});
