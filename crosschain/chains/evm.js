// crosschain/chains/evm.js
//
// EVM delivery handler. One instance per configured EVM chain — each gets its
// own provider, wallet, expected chainId and confirmation count, so adding
// "eip155:8453" (Base) is a pure config entry in config.js, no code here.
//
// Handler contract (shared by every file in chains/):
//
//   handler.chain          - CAIP-2 id this handler is registered under
//   handler.name           - human label for logs
//   handler.walletAddress  - custody address (informational)
//   await handler.init()   - boot sanity checks; THROWS to abort startup
//   await handler.deliver(event)
//        -> resolves to a plain state-info object `{ status, ... }` for any
//           TERMINAL outcome (delivered, skipped, permanently invalid). The
//           caller merges it into the state file and never retries.
//        -> THROWS for anything retryable. The queue's retry policy takes over
//           and, once exhausted, records `status: 'failed'` + the message.
//
// Idempotency: ERC721 deliveries are additionally guarded by ownerOf (a repeat
// attempt structurally cannot double-send). ERC20 has no such guard, so it
// relies solely on the durable state file — acceptable because the state file
// already gates every single event before it ever reaches a handler.

const { ethers } = require('ethers');
const { ERC721_ABI, ERC20_ABI } = require('../abi');
const { withRetry, waitWithTimeout } = require('../rpc');

const ZERO = ethers.ZeroAddress;

// --- helpers -------------------------------------------------------------

function hexByteLength(hex) {
  if (typeof hex !== 'string' || !hex.startsWith('0x')) return -1;
  const body = hex.slice(2);
  if (body.length % 2 !== 0) return -1;
  return body.length / 2;
}

// `data` is the free-form redirect blob from the Redeemed event.
//   - exactly 20 bytes            -> raw address, use as recipient override
//   - exactly 32 bytes, 12 zeros  -> abi.encode(address), decode and use
//   - anything else               -> ignore entirely, use the event recipient
// A zero-address override is never honoured; we fall back to the recipient.
function resolveRecipient(eventRecipient, data) {
  let fallback = eventRecipient ? String(eventRecipient) : null;
  if (fallback) {
    try {
      fallback = ethers.getAddress(fallback);
    } catch {
      /* leave as-is; the zero/empty guard downstream will catch garbage */
    }
  }
  const len = hexByteLength(data);

  let candidate = null;
  if (len === 20) {
    candidate = data;
  } else if (len === 32) {
    const prefix = data.slice(2, 26); // first 12 bytes
    if (/^0{24}$/.test(prefix)) {
      candidate = `0x${data.slice(26)}`;
    }
  }

  if (candidate == null) {
    return { recipient: fallback, overrideApplied: false };
  }

  let checksummed;
  try {
    checksummed = ethers.getAddress(candidate);
  } catch {
    console.warn(`[transfer] data override ${data} is not a valid address — ignoring`);
    return { recipient: fallback, overrideApplied: false };
  }

  if (checksummed === ZERO) {
    console.warn('[transfer] data override decoded to the zero address — ignoring');
    return { recipient: fallback, overrideApplied: false };
  }

  console.log(
    `[transfer] recipient override from data: ${checksummed} (event recipient was ${fallback})`
  );
  return { recipient: checksummed, overrideApplied: true };
}

// `assetAddress` arrives from viem as a hex string (Solidity `bytes`). For EVM
// destinations it MUST be exactly 20 bytes; anything else is a mint-time
// mistake that no amount of retrying will fix.
function resolveAssetAddress(assetAddress) {
  if (hexByteLength(assetAddress) !== 20) {
    return {
      ok: false,
      error: `assetAddress ${assetAddress} is not 20 bytes (got ${hexByteLength(assetAddress)})`,
    };
  }
  try {
    return { ok: true, address: ethers.getAddress(assetAddress) };
  } catch (e) {
    return { ok: false, error: `assetAddress ${assetAddress} is not a valid address: ${e.message}` };
  }
}

// --- handler factory -----------------------------------------------------

function createEvmHandler(cfg) {
  const {
    chain,
    name,
    rpcUrl,
    privateKey,
    expectedChainId,
    confirmations,
    nativeSymbol = 'ETH',
    lowBalanceThreshold,
    tx: txCfg,
  } = cfg;

  if (!rpcUrl) throw new Error(`[config] ${chain}: missing rpcUrl`);
  if (!privateKey) throw new Error(`[config] ${chain}: missing privateKey`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  let wallet;
  try {
    wallet = new ethers.Wallet(privateKey, provider);
  } catch (e) {
    throw new Error(
      `[config] ${chain}: private key is not a valid hex key (${e.shortMessage || e.message})`
    );
  }

  const expected = BigInt(expectedChainId);
  const confs = confirmations ?? 1;

  // Builds fee + gasLimit overrides: 1.5x fees so we land in a block reliably,
  // 1.5x the gas estimate so an unexpected code path can't run us out of gas.
  async function buildOverrides(label, estimateFn) {
    const feeData = await withRetry(`${chain} getFeeData`, () => provider.getFeeData());
    const overrides = {};

    if (feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null) {
      overrides.maxPriorityFeePerGas =
        (feeData.maxPriorityFeePerGas * txCfg.gasBumpNumerator) / txCfg.gasBumpDenominator;
      overrides.maxFeePerGas =
        (feeData.maxFeePerGas * txCfg.gasBumpNumerator) / txCfg.gasBumpDenominator;
      console.log(
        `[transfer] fee bump: maxFee=${ethers.formatUnits(overrides.maxFeePerGas, 'gwei')} gwei ` +
          `prio=${ethers.formatUnits(overrides.maxPriorityFeePerGas, 'gwei')} gwei`
      );
    } else if (feeData.gasPrice != null) {
      overrides.gasPrice =
        (feeData.gasPrice * txCfg.gasBumpNumerator) / txCfg.gasBumpDenominator;
      console.log(
        `[transfer] fee bump: gasPrice=${ethers.formatUnits(overrides.gasPrice, 'gwei')} gwei`
      );
    } else {
      throw new Error(`No fee data returned from ${chain} provider`);
    }

    const gasEstimate = await withRetry(`${chain} estimateGas ${label}`, estimateFn);
    overrides.gasLimit =
      (gasEstimate * txCfg.gasLimitBufferNumerator) / txCfg.gasLimitBufferDenominator;
    console.log(`[transfer] gasLimit=${overrides.gasLimit} (estimated ${gasEstimate})`);

    return overrides;
  }

  async function sendAndConfirm(sendFn, label) {
    const tx = await sendFn();
    console.log(`[transfer] sent ${chain} tx ${tx.hash}; awaiting ${confs} conf(s)...`);
    const receipt = await waitWithTimeout(tx.wait(confs), txCfg.timeoutMs, `tx ${tx.hash}`);
    if (!receipt || receipt.status !== 1) {
      throw new Error(`tx ${tx.hash} did not succeed (status=${receipt?.status})`);
    }
    console.log(
      `✅ [transfer] ${label} mined block=${receipt.blockNumber} tx=${tx.hash} gasUsed=${receipt.gasUsed}`
    );
    return { tx, receipt };
  }

  // --- ERC721 ---
  async function deliverErc721(event, assetAddr, recipient) {
    const nft = new ethers.Contract(assetAddr, ERC721_ABI, wallet);
    const assetTokenId = event.assetTokenId;

    // Idempotency guard: if a previous attempt already transferred (or someone
    // else moved the token), ownerOf will not return our address and we abort
    // cleanly instead of double-sending.
    const owner = await withRetry(`${chain} ownerOf(${assetTokenId})`, () =>
      nft.ownerOf(assetTokenId)
    );
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      console.warn(
        `[transfer] skip: ${assetAddr} #${assetTokenId} owned by ${owner}, not us (${wallet.address})`
      );
      return { status: 'not_owned', owner };
    }

    const overrides = await buildOverrides(`transferFrom(${assetTokenId})`, () =>
      nft.transferFrom.estimateGas(wallet.address, recipient, assetTokenId)
    );

    const { tx, receipt } = await sendAndConfirm(
      () => nft.transferFrom(wallet.address, recipient, assetTokenId, overrides),
      `ERC721 ${assetAddr} #${assetTokenId} → ${recipient}`
    );

    return {
      status: 'transferred',
      assetType: 'erc721',
      deliveryTxHash: tx.hash,
      deliveryBlock: Number(receipt.blockNumber),
    };
  }

  // --- ERC20 ---
  async function deliverErc20(event, assetAddr, recipient) {
    const token = new ethers.Contract(assetAddr, ERC20_ABI, wallet);
    const amount = BigInt(event.amount);

    if (amount <= 0n) {
      return { status: 'invalid_amount', error: `amount must be > 0 (got ${amount})` };
    }

    // decimals/symbol are purely cosmetic — never let them break a delivery.
    let pretty = `${amount}`;
    try {
      const [decimals, symbol] = await Promise.all([
        withRetry(`${chain} decimals()`, () => token.decimals()),
        withRetry(`${chain} symbol()`, () => token.symbol()),
      ]);
      pretty = `${ethers.formatUnits(amount, decimals)} ${symbol} (${amount} raw)`;
    } catch {
      /* non-standard token — log raw units */
    }

    const balance = await withRetry(`${chain} balanceOf(${wallet.address})`, () =>
      token.balanceOf(wallet.address)
    );
    if (balance < amount) {
      // Almost certainly permanent, but we let it flow through the normal retry
      // policy: a top-up between attempts is a real (if unlikely) recovery.
      throw new Error(
        `insufficient_balance: ${assetAddr} balance ${balance} < required ${amount}`
      );
    }

    console.log(`[transfer] ERC20 ${assetAddr} sending ${pretty} → ${recipient}`);

    const overrides = await buildOverrides(`transfer(${amount})`, () =>
      token.transfer.estimateGas(recipient, amount)
    );

    const { tx, receipt } = await sendAndConfirm(
      () => token.transfer(recipient, amount, overrides),
      `ERC20 ${assetAddr} ${pretty} → ${recipient}`
    );

    return {
      status: 'transferred',
      assetType: 'erc20',
      amountFormatted: pretty,
      deliveryTxHash: tx.hash,
      deliveryBlock: Number(receipt.blockNumber),
    };
  }

  return {
    kind: 'evm',
    chain,
    name,
    walletAddress: wallet.address,
    provider,

    // Boot sanity. Wrong-network config is the easiest way to fat-finger this
    // kind of bridge worker, so a chainId mismatch is fatal. The balance read
    // is informational only — a throttled RPC at boot must not take us offline.
    async init() {
      const net = await withRetry(`${chain} getNetwork`, () => provider.getNetwork());
      if (BigInt(net.chainId) !== expected) {
        throw new Error(
          `${chain} (${name}) RPC is on chainId=${net.chainId}, expected ${expected}`
        );
      }
      console.log(`🔗 ${chain} (${name}) chainId verified: ${net.chainId}`);

      try {
        const bal = await withRetry(`${chain} getBalance`, () =>
          provider.getBalance(wallet.address)
        );
        console.log(
          `👤 ${chain} wallet ${wallet.address} balance ${ethers.formatEther(bal)} ${nativeSymbol}`
        );
        if (lowBalanceThreshold != null && bal < lowBalanceThreshold) {
          console.warn(
            `⚠️  ${chain} native balance is low. Top up before transfers will go out.`
          );
        }
      } catch (e) {
        console.warn(
          `⚠️  Could not read ${chain} balance for ${wallet.address} ` +
            `(${e.shortMessage || e.message || e}). Continuing — if your RPC is ` +
            `rate-limiting on boot, switch to a dedicated endpoint (Alchemy/Infura/Quicknode).`
        );
      }
    },

    async deliver(event) {
      const { recipient, overrideApplied } = resolveRecipient(event.recipient, event.data);

      if (!recipient || recipient === ZERO || recipient.toLowerCase() === ZERO.toLowerCase()) {
        console.warn('[transfer] skip: zero/empty recipient');
        return { status: 'skipped_zero_recipient', recipientUsed: recipient, overrideApplied };
      }

      const asset = resolveAssetAddress(event.assetAddress);
      if (!asset.ok) {
        console.error(`[transfer] permanent failure: ${asset.error}`);
        return {
          status: 'invalid_asset_address',
          error: asset.error,
          recipientUsed: recipient,
          overrideApplied,
        };
      }

      console.log(
        `[transfer] ${chain} tokenId=${event.tokenId} ` +
          `${event.isERC20 ? `ERC20 ${asset.address} amount=${event.amount}` : `ERC721 ${asset.address} #${event.assetTokenId}`} ` +
          `→ ${recipient} (apechain tx ${event.txHash})`
      );

      const result = event.isERC20
        ? await deliverErc20(event, asset.address, recipient)
        : await deliverErc721(event, asset.address, recipient);

      return {
        ...result,
        assetContract: asset.address,
        recipientUsed: recipient,
        overrideApplied,
      };
    },
  };
}

module.exports = { createEvmHandler, resolveRecipient, resolveAssetAddress, hexByteLength };
