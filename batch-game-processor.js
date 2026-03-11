require('dotenv').config();

const { ethers } = require('ethers');
const { createPublicClient, webSocket, decodeEventLog } = require('viem');
const { apechain } = require('viem/chains');

const {
  APECHAIN_RPC_URL,
  APECHAIN_WSS_URL,
  PRIVATE_KEY
} = process.env;

const GAME_FULL_RESOLVE_MAX_GAS = 28_000_000n;
const GAME_CONTRACT_ADDRESS = "0x5E405198B349d6522BbB614E7391bDC4F4F6f681";

const GAME_PROCESSOR_ABI = [
  {
    type: 'event',
    name: 'RandomnessReturned',
    anonymous: false,
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'numSpins', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'GameResolutionProgress',
    anonymous: false,
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'startSpinIndex', type: 'uint8', indexed: false },
      { name: 'endSpinIndex', type: 'uint8', indexed: false },
      { name: 'totalPayout', type: 'uint256', indexed: false },
      { name: 'isFinal', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'GameEnded',
    anonymous: false,
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'gameId', type: 'uint256', indexed: false },
      { name: 'buyIn', type: 'uint256', indexed: false },
      { name: 'payout', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'resolveGameFully',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [],
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
];

const POLL_INTERVAL_MS = 10_000;
const CHUNK_SIZE = 5;
const PRIORITY_FEE_BUMP_GWEI = '4';
const DEFAULT_FULL_RESOLVE_MAX_GAS = 10_500_000n;
const SINGLE_GAS_BUFFER_PERCENT = 105n;
const ATTEMPT_COOLDOWN_MS = 20_000;
const STALE_IN_FLIGHT_MS = 120_000;
const COMPLETED_GAME_TTL_MS = 6 * 60 * 60 * 1000;
const FULL_RESOLVE_MAX_GAS = GAME_FULL_RESOLVE_MAX_GAS
  ? BigInt(GAME_FULL_RESOLVE_MAX_GAS)
  : DEFAULT_FULL_RESOLVE_MAX_GAS;

if (!APECHAIN_RPC_URL || !APECHAIN_WSS_URL || !PRIVATE_KEY) {
  console.error('Missing required environment variables. Expected APECHAIN_RPC_URL, APECHAIN_WSS_URL, and PRIVATE_KEY.');
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

const knownGames = new Map();
const inFlightGames = new Map();
const recentAttempts = new Map();
const completedGames = new Map();

let pollingInProgress = false;
const stopWatchers = [];
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

function getChunkCount(numSpins) {
  return Math.ceil(numSpins / CHUNK_SIZE);
}

function rememberGame(gameId, numSpins) {
  const gameIdKey = toGameIdKey(gameId);
  knownGames.set(gameIdKey, {
    numSpins: Number(numSpins),
    chunkCount: getChunkCount(Number(numSpins)),
    updatedAt: now(),
  });
}

function clearExpiredState() {
  const currentTime = now();

  for (const [gameId, state] of inFlightGames.entries()) {
    if (currentTime - state.startedAt > STALE_IN_FLIGHT_MS) {
      console.warn(`[State] Clearing stale in-flight marker for game ${gameId}.`);
      inFlightGames.delete(gameId);
    }
  }

  for (const [gameId, attemptedAt] of recentAttempts.entries()) {
    if (currentTime - attemptedAt > ATTEMPT_COOLDOWN_MS) {
      recentAttempts.delete(gameId);
    }
  }

  for (const [gameId, completedAt] of completedGames.entries()) {
    if (currentTime - completedAt > COMPLETED_GAME_TTL_MS) {
      completedGames.delete(gameId);
      knownGames.delete(gameId);
    }
  }
}

function isInFlight(gameId) {
  const state = inFlightGames.get(gameId);
  return !!state && now() - state.startedAt <= STALE_IN_FLIGHT_MS;
}

function wasAttemptedRecently(gameId) {
  const attemptedAt = recentAttempts.get(gameId);
  return typeof attemptedAt === 'number' && now() - attemptedAt <= ATTEMPT_COOLDOWN_MS;
}

function isCompleted(gameId) {
  const completedAt = completedGames.get(gameId);
  return typeof completedAt === 'number' && now() - completedAt <= COMPLETED_GAME_TTL_MS;
}

function markInFlight(gameId, mode) {
  inFlightGames.set(gameId, {
    startedAt: now(),
    pendingTxs: 0,
    mode,
  });
}

function clearInFlight(gameId) {
  inFlightGames.delete(gameId);
}

function markRecentAttempt(gameId) {
  recentAttempts.set(gameId, now());
}

function incrementPendingTx(gameId) {
  const state = inFlightGames.get(gameId);
  if (!state) {
    return;
  }

  state.pendingTxs += 1;
  state.startedAt = now();
}

function decrementPendingTx(gameId) {
  const state = inFlightGames.get(gameId);
  if (!state) {
    return;
  }

  state.pendingTxs = Math.max(0, state.pendingTxs - 1);
  state.startedAt = now();

  if (state.pendingTxs === 0 && !isCompleted(gameId)) {
    clearInFlight(gameId);
    markRecentAttempt(gameId);
  }
}

function markGameDone(gameId, source) {
  const gameIdKey = toGameIdKey(gameId);

  if (isCompleted(gameIdKey)) {
    return;
  }

  completedGames.set(gameIdKey, now());
  clearInFlight(gameIdKey);
  recentAttempts.delete(gameIdKey);
  console.log(`[${source}] Game ${gameIdKey} marked complete.`);
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

async function monitorTransaction(tx, label, gameId) {
  try {
    const receipt = await tx.wait();
    console.log(`[${label}] Tx mined in block ${receipt.blockNumber}: ${tx.hash}`);
  } catch (error) {
    console.warn(`[${label}] Tx monitoring error for ${tx.hash}: ${getErrorMessage(error)}`);
  } finally {
    decrementPendingTx(gameId);
  }
}

async function submitChunkResolve(gameId, source, indexLabel) {
  const gameIdKey = toGameIdKey(gameId);
  incrementPendingTx(gameIdKey);

  try {
    const feeOverrides = await getFeeOverrides();
    const gasEstimate = await contract.resolveGame.estimateGas(gameId);
    const gasLimit = addGasBuffer(gasEstimate, SINGLE_GAS_BUFFER_PERCENT);

    console.log(`[${source}] Submitting chunk ${indexLabel} for game ${gameIdKey}...`);

    const tx = await contract.resolveGame(gameId, {
      gasLimit,
      maxPriorityFeePerGas: feeOverrides.maxPriorityFeePerGas,
      maxFeePerGas: feeOverrides.maxFeePerGas,
    });

    console.log(`[${source}] resolveGame submitted for ${gameIdKey}: ${tx.hash}`);
    void monitorTransaction(tx, `${source}:resolveGame:${indexLabel}`, gameIdKey);
    return true;
  } catch (error) {
    decrementPendingTx(gameIdKey);

    if (isExpectedRaceError(error)) {
      markRecentAttempt(gameIdKey);
      console.warn(`[${source}] resolveGame skipped for ${gameIdKey}: ${getErrorMessage(error)}`);
      return false;
    }

    console.error(`[${source}] resolveGame failed for ${gameIdKey}: ${getErrorMessage(error)}`);
    return false;
  }
}

async function submitFullResolve(gameId, source, gasEstimate) {
  const gameIdKey = toGameIdKey(gameId);
  incrementPendingTx(gameIdKey);

  try {
    const feeOverrides = await getFeeOverrides();
    const gasLimit = addGasBuffer(gasEstimate, SINGLE_GAS_BUFFER_PERCENT);

    console.log(`[${source}] Full resolve tx for game ${gameIdKey} with estimated gas ${gasEstimate.toString()}.`);

    const tx = await contract.resolveGameFully(gameId, {
      gasLimit,
      maxPriorityFeePerGas: feeOverrides.maxPriorityFeePerGas,
      maxFeePerGas: feeOverrides.maxFeePerGas,
    });

    console.log(`[${source}] resolveGameFully submitted for ${gameIdKey}: ${tx.hash}`);
    void monitorTransaction(tx, `${source}:resolveGameFully`, gameIdKey);
    return true;
  } catch (error) {
    if (isExpectedRaceError(error)) {
      markRecentAttempt(gameIdKey);
      console.warn(`[${source}] resolveGameFully skipped for ${gameIdKey}: ${getErrorMessage(error)}`);
      decrementPendingTx(gameIdKey);
      return false;
    }

    console.error(`[${source}] resolveGameFully failed for ${gameIdKey}: ${getErrorMessage(error)}`);
    decrementPendingTx(gameIdKey);
    return false;
  }
}

async function resolveGameInChunks(gameId, numSpins, source) {
  const gameIdKey = toGameIdKey(gameId);
  const chunkCount = getChunkCount(numSpins);
  let submittedCount = 0;

  console.log(`[${source}] Falling back to ${chunkCount} chunk tx(s) for game ${gameIdKey} (${numSpins} spins).`);

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    if (isCompleted(gameIdKey)) {
      console.log(`[${source}] Game ${gameIdKey} already finalized before chunk ${chunkIndex + 1}.`);
      break;
    }

    const submitted = await submitChunkResolve(
      gameIdKey,
      source,
      `${chunkIndex + 1}/${chunkCount}`
    );

    if (submitted) {
      submittedCount += 1;
    }
  }

  if (submittedCount === 0 && !isCompleted(gameIdKey)) {
    clearInFlight(gameIdKey);
    markRecentAttempt(gameIdKey);
  }
}

async function attemptGameResolution(gameId, source, numSpins = null) {
  const gameIdKey = toGameIdKey(gameId);

  if (typeof numSpins === 'number') {
    rememberGame(gameIdKey, numSpins);
  }

  if (isCompleted(gameIdKey)) {
    console.log(`[${source}] Game ${gameIdKey} is already complete.`);
    return;
  }

  if (isInFlight(gameIdKey)) {
    console.log(`[${source}] Game ${gameIdKey} is already being processed, skipping duplicate trigger.`);
    return;
  }

  if (wasAttemptedRecently(gameIdKey)) {
    console.log(`[${source}] Game ${gameIdKey} was attempted recently, skipping duplicate trigger.`);
    return;
  }

  markInFlight(gameIdKey, 'resolving');

  try {
    const fullResolveGasEstimate = await contract.resolveGameFully.estimateGas(gameId);
    console.log(`[${source}] resolveGameFully estimate for ${gameIdKey}: ${fullResolveGasEstimate.toString()}`);

    if (fullResolveGasEstimate <= FULL_RESOLVE_MAX_GAS) {
      const fullResolveSubmitted = await submitFullResolve(gameIdKey, source, fullResolveGasEstimate);

      if (fullResolveSubmitted) {
        return;
      }
    } else {
      console.log(
        `[${source}] Full resolve estimate ${fullResolveGasEstimate.toString()} exceeds threshold ${FULL_RESOLVE_MAX_GAS.toString()}, switching to chunks for game ${gameIdKey}.`
      );
    }
  } catch (error) {
    console.warn(`[${source}] resolveGameFully estimate failed for ${gameIdKey}: ${getErrorMessage(error)}`);
  }

  const knownNumSpins = numSpins ?? knownGames.get(gameIdKey)?.numSpins ?? null;

  if (typeof knownNumSpins === 'number') {
    await resolveGameInChunks(gameIdKey, knownNumSpins, source);
    return;
  }

  console.warn(
    `[${source}] No numSpins cached for game ${gameIdKey}; submitting a single recovery chunk and letting the next poll continue if needed.`
  );

  const submittedRecoveryChunk = await submitChunkResolve(gameIdKey, `${source}:recovery`, '1/?');

  if (!submittedRecoveryChunk && !isCompleted(gameIdKey)) {
    clearInFlight(gameIdKey);
    markRecentAttempt(gameIdKey);
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

    for (const gameIdKey of normalizedGameIds) {
      const cachedNumSpins = knownGames.get(gameIdKey)?.numSpins ?? null;
      await attemptGameResolution(gameIdKey, 'poll', cachedNumSpins);
    }
  } catch (error) {
    console.error(`[poll] Failed to read pending games: ${getErrorMessage(error)}`);
  } finally {
    pollingInProgress = false;
  }
}

async function startListener() {
  console.log(`Listening for RandomnessReturned on ${GAME_CONTRACT_ADDRESS}...`);

  stopWatchers.push(publicClient.watchContractEvent({
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
          const numSpins = Number(decodedLog.args.numSpins);
          rememberGame(gameId, numSpins);
          console.log(`[event] RandomnessReturned detected for game ${gameId} with ${numSpins} spins in tx ${log.transactionHash}`);
          void attemptGameResolution(gameId, 'event', numSpins);
        } catch (error) {
          console.error(`[event] Failed to decode or process log: ${getErrorMessage(error)}`);
        }
      }
    },
    onError: (error) => {
      console.error(`[event] Listener error: ${getErrorMessage(error)}`);
    },
  }));

  stopWatchers.push(publicClient.watchContractEvent({
    address: GAME_CONTRACT_ADDRESS,
    abi: GAME_PROCESSOR_ABI,
    eventName: 'GameResolutionProgress',
    onLogs: async (logs) => {
      for (const log of logs) {
        try {
          const decodedLog = decodeEventLog({
            abi: GAME_PROCESSOR_ABI,
            data: log.data,
            topics: log.topics,
          });

          const gameId = decodedLog.args.gameId.toString();
          const isFinal = decodedLog.args.isFinal;
          console.log(
            `[progress] Game ${gameId} resolved spins ${decodedLog.args.startSpinIndex}-${decodedLog.args.endSpinIndex}, final=${isFinal}.`
          );

          if (isFinal) {
            markGameDone(gameId, 'progress');
          }
        } catch (error) {
          console.error(`[progress] Failed to decode or process log: ${getErrorMessage(error)}`);
        }
      }
    },
    onError: (error) => {
      console.error(`[progress] Listener error: ${getErrorMessage(error)}`);
    },
  }));

  stopWatchers.push(publicClient.watchContractEvent({
    address: GAME_CONTRACT_ADDRESS,
    abi: GAME_PROCESSOR_ABI,
    eventName: 'GameEnded',
    onLogs: async (logs) => {
      for (const log of logs) {
        try {
          const decodedLog = decodeEventLog({
            abi: GAME_PROCESSOR_ABI,
            data: log.data,
            topics: log.topics,
          });

          const gameId = decodedLog.args.gameId.toString();
          console.log(`[ended] GameEnded detected for game ${gameId} in tx ${log.transactionHash}`);
          markGameDone(gameId, 'ended');
        } catch (error) {
          console.error(`[ended] Failed to decode or process log: ${getErrorMessage(error)}`);
        }
      }
    },
    onError: (error) => {
      console.error(`[ended] Listener error: ${getErrorMessage(error)}`);
    },
  }));
}

function setupShutdownHandlers() {
  const shutdown = async (signal) => {
    console.log(`Received ${signal}. Shutting down game processor...`);

    if (pollIntervalHandle) {
      clearInterval(pollIntervalHandle);
      pollIntervalHandle = null;
    }

    while (stopWatchers.length > 0) {
      const stopWatching = stopWatchers.pop();
      if (stopWatching) {
        stopWatching();
      }
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
  console.log(`Full resolve gas threshold: ${FULL_RESOLVE_MAX_GAS.toString()}`);

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
