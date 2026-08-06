// crosschain/state.js
//
// Durable JSON state, one file per watched contract:
//
//   crosschain/state/crosschain-state-<contractAddressLowercase>.json
//
//   {
//     "processed": { "<txHashLower>:<logIndex>": { ...rich info... } },
//     "lastSeenBlock": "12345678"      // string, so BigInts survive JSON
//   }
//
// Every write is atomic (tmp file + rename) so a mid-write crash can never
// leave a truncated/corrupt state file behind — this file is the ONLY thing
// standing between a reconnect and a duplicate asset delivery.

const fs = require('fs');
const path = require('path');

// JSON.stringify throws on BigInt. Event args arrive from viem as BigInt, so we
// defensively coerce anything that slipped through into a decimal string.
function bigintSafeReplacer(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}

function eventKey(txHash, logIndex) {
  return `${String(txHash).toLowerCase()}:${Number(logIndex)}`;
}

function createState({ contractAddress, dir }) {
  const stateDir = dir || path.join(__dirname, 'state');
  fs.mkdirSync(stateDir, { recursive: true });

  const file = path.join(
    stateDir,
    `crosschain-state-${String(contractAddress).toLowerCase()}.json`
  );

  let processed = {};
  let lastSeenBlock = null;

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    processed = parsed.processed || {};
    lastSeenBlock = parsed.lastSeenBlock != null ? BigInt(parsed.lastSeenBlock) : null;
  } catch {
    processed = {};
    lastSeenBlock = null;
  }

  function save() {
    const out = {
      processed,
      lastSeenBlock: lastSeenBlock != null ? lastSeenBlock.toString() : null,
    };
    // Atomic write: temp then rename.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out, bigintSafeReplacer, 2));
    fs.renameSync(tmp, file);
  }

  return {
    file,

    get processedCount() {
      return Object.keys(processed).length;
    },

    get lastSeenBlock() {
      return lastSeenBlock;
    },

    isProcessed(key) {
      return Boolean(processed[key]);
    },

    getProcessed(key) {
      return processed[key];
    },

    markProcessed(key, info) {
      processed[key] = { ...info, processedAt: new Date().toISOString() };
      save();
    },

    noteSeenBlock(blockNumber) {
      if (blockNumber == null) return;
      const blk = BigInt(blockNumber);
      if (lastSeenBlock == null || blk > lastSeenBlock) {
        lastSeenBlock = blk;
        save();
      }
    },

    save,
  };
}

module.exports = { createState, eventKey, bigintSafeReplacer };
