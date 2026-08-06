// crosschain/queue.js
//
// Sequential, in-process work queue.
//
// Sequential matters: every delivery goes out from ONE wallet per chain, so
// parallelism here would race the nonce. It is also far friendlier to rate
// limited RPCs. Retry policy is v1's: MAX_RETRIES attempts of re-queue after
// RETRY_DELAY_MS, then the failure is recorded to durable state and dropped.
//
// The queue owns ordering + retries only. Deciding WHAT a terminal failure
// should look like in the state file is the caller's job (onTerminalFailure).

function createQueue({ isProcessed, handle, onTerminalFailure, maxRetries, retryDelayMs }) {
  const items = [];
  const enqueuedKeys = new Set();
  let processing = false;
  let pendingRetries = 0;

  function enqueue(item) {
    if (isProcessed(item.key)) return;
    if (enqueuedKeys.has(item.key)) return;
    enqueuedKeys.add(item.key);
    items.push(item);
    if (!processing) {
      runQueue().catch((e) => console.error('[queue] runQueue threw:', e));
    }
  }

  async function runQueue() {
    processing = true;
    try {
      while (items.length > 0) {
        const item = items.shift();
        if (isProcessed(item.key)) {
          enqueuedKeys.delete(item.key);
          continue;
        }
        try {
          await handle(item);
          enqueuedKeys.delete(item.key);
        } catch (e) {
          const msg = e.shortMessage || e.message || String(e);
          const attempt = (item.retries ?? 0) + 1;
          console.error(`[queue] item ${item.key} failed (attempt ${attempt}): ${msg}`);

          enqueuedKeys.delete(item.key);
          if (attempt <= maxRetries) {
            const next = { ...item, retries: attempt };
            pendingRetries++;
            const timer = setTimeout(() => {
              pendingRetries--;
              enqueue(next);
            }, retryDelayMs);
            if (typeof timer.unref === 'function') timer.unref();
            console.warn(`[queue] retrying ${item.key} in ${retryDelayMs}ms`);
          } else {
            try {
              onTerminalFailure(item, msg);
            } catch (recordErr) {
              console.error('[queue] failed to record terminal failure:', recordErr);
            }
            console.error(`[queue] giving up on ${item.key}; failure recorded to state file`);
          }
        }
      }
    } finally {
      processing = false;
    }
  }

  return {
    enqueue,
    get size() {
      return items.length;
    },
    get processing() {
      return processing;
    },
    get pendingRetries() {
      return pendingRetries;
    },
    isIdle() {
      return !processing && items.length === 0;
    },
  };
}

module.exports = { createQueue };
