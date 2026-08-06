// crosschain/rpc.js
//
// Small, dependency-free reliability helpers shared by every chain handler and
// by the ApeChain ingest side. Carried over verbatim (behaviour-wise) from v1.
//
//   sleep(ms)                       - promise timer
//   waitWithTimeout(p, ms, label)   - reject if a promise outlives `ms`
//   isTransientRpcError(err)        - "is this worth retrying?" heuristic
//   withRetry(label, fn, opts)      - exponential backoff around a read call
//
// NOTE: withRetry is for READ-side RPC calls only. We deliberately do NOT wrap
// sendTransaction with it — that path is governed by the queue's retry policy
// plus the per-handler idempotency guards (ownerOf / durable state file).

// Backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped) — same as v1.
const RPC_MAX_ATTEMPTS = 6;
const RPC_BACKOFF_BASE_MS = 1000;
const RPC_BACKOFF_CAP_MS = 30 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitWithTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Crude retry classifier for read-side RPC calls. Identifies common transient
// failures (429s, timeouts, ECONNRESET, etc.).
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

async function withRetry(label, fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? RPC_MAX_ATTEMPTS;
  const baseMs = opts.baseMs ?? RPC_BACKOFF_BASE_MS;
  const capMs = opts.capMs ?? RPC_BACKOFF_CAP_MS;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (e) {
      const transient = isTransientRpcError(e);
      const msg = e.shortMessage || e.message || String(e);
      if (!transient || attempt >= maxAttempts) {
        throw e;
      }
      const delay = Math.min(capMs, baseMs * 2 ** (attempt - 1));
      console.warn(
        `[rpc] ${label} transient failure (attempt ${attempt}/${maxAttempts}): ${msg} — retrying in ${delay}ms`
      );
      await sleep(delay);
    }
  }
}

module.exports = {
  RPC_MAX_ATTEMPTS,
  RPC_BACKOFF_BASE_MS,
  RPC_BACKOFF_CAP_MS,
  sleep,
  waitWithTimeout,
  isTransientRpcError,
  withRetry,
};
