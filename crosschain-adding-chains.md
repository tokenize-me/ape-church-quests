# CrossChain v2 — Adding New Chains

How to extend the redemption system to deliver assets on chains beyond
Ethereum mainnet. Written for a future agent or developer picking this up
cold. Companion docs: `crosschain-v2-spec.md` (system design) and
`crosschain-admin-minting.md` (minting).

## Architecture in one paragraph

The CrossChainNFT contract on ApeChain emits
`Redeemed(tokenId, recipient, chain, assetAddress, assetTokenId, isERC20, amount, data)`
when a ticket burns. The worker (`crosschain/index.js`) decodes the event and
looks up a **handler** for the event's `chain` string in the registry built in
`crosschain/config.js`. The handler does the actual delivery. Everything else
(dedupe, queue, retries, backfill) is chain-agnostic and lives outside the
handlers. **`config.js` is the only file that knows which chains exist.**

Chain identifiers are CAIP-2 strings: `"eip155:<chainId>"` for EVM chains
(`eip155:1` mainnet, `eip155:8453` Base, `eip155:42161` Arbitrum),
`"solana:mainnet"` style for others. The string minted into a ticket must
match a registry key **exactly** at redeem time.

## The handler contract (what every handler must implement)

```js
{
  chain,          // the CAIP-2 id it is registered under
  name,           // human label for logs
  walletAddress,  // custody address on that chain (informational, for logs)
  async init(),   // boot sanity checks. THROW to abort worker startup
                  // (e.g. RPC on wrong network). Non-fatal checks just warn.
  async deliver(event),
                  // Perform the delivery. Two ways to finish:
                  // - RETURN a plain object { status, ...anything } for any
                  //   TERMINAL outcome (success or permanent failure). It is
                  //   merged into the state file and NEVER retried.
                  //   Use status: 'transferred' for success.
                  // - THROW for anything retryable (RPC flake, low balance
                  //   that a top-up could fix). The queue retries once after
                  //   30s, then records status: 'failed' with the message.
}
```

`deliver(event)` receives the fully-decoded event item:

```js
{
  key,           // "txHashLower:logIndex" — the dedupe key
  tokenId,       // BigInt — the burned ticket id (local, ApeChain)
  recipient,     // EVM address string — ticket holder at burn time
  chain,         // string — matches your registration key
  assetAddress,  // hex string of the Solidity `bytes` (0x…, chain-native encoding)
  assetTokenId,  // BigInt — source NFT id (ignore when isERC20)
  isERC20,       // boolean
  amount,        // BigInt — RAW token units (ignore when !isERC20)
  data,          // hex string of redeemer-supplied bytes ('0x' when empty)
  blockNumber,   // BigInt — ApeChain block
  txHash,        // ApeChain redeem tx hash (lowercase)
}
```

Reliability rules a handler must follow:

- **Idempotency is your job for the send itself.** The state file guarantees an
  event is only *dispatched* once per run history, but if your send lands and
  the process dies before the state write, backfill will re-dispatch it. The
  EVM ERC721 path guards this with `ownerOf` (re-attempt sees the asset is
  gone and returns `not_owned`). Add an equivalent cheap "already delivered?"
  pre-check on your chain whenever one exists.
- Wrap read RPC calls in `withRetry` from `crosschain/rpc.js`; do NOT wrap the
  actual send (the queue's retry policy owns that).
- Never `process.exit` or hang forever — bound waits with `waitWithTimeout`.

## Case 1: adding another EVM chain (config-only, no code)

Example: Base.

1. In `crosschain/config.js`, add an entry to `EVM_CHAINS` (a commented
   template already sits there):

```js
{
  chain: 'eip155:8453',
  name: 'Base',
  rpcUrl: process.env.BASE_RPC_URL,
  privateKey: process.env.BASE_PRIVATE_KEY || ethPrivateKey,
  expectedChainId: 8453n,     // boot-verified against the RPC; mismatch = fatal
  confirmations: 1,
  nativeSymbol: 'ETH',
  lowBalanceThreshold: ethers.parseEther('0.005'),
},
```

2. Add `BASE_RPC_URL` (and ideally `BASE_PRIVATE_KEY`) to the droplet `.env`.
   Prefer a **separate custody key per chain** — the registry supports it, and
   it contains the blast radius if a key leaks. Reusing `ethPrivateKey` works
   (same address on every EVM chain) but couples all custody to one secret.
3. Fund that chain's custody wallet with native gas and move the prize assets
   into it.
4. Restart the worker (`pm2 restart crosschain`) and check the boot log for
   `🔗 eip155:8453 (Base) chainId verified`.
5. Mint tickets with `chain: 'eip155:8453'`. Done — `chains/evm.js` already
   handles ERC721 + ERC20 on any EVM chain, including the fee-bump/gas-buffer
   logic and the `data` recipient-override rules.

## Case 2: adding a non-EVM chain (one new file + one registry line)

Example shape for Solana — the same pattern applies to any chain.

1. **Create `crosschain/chains/solana.js`** exporting a factory that returns
   the handler contract above:

```js
function createSolanaHandler(cfg) {
  // cfg: { chain, name, rpcUrl, secretKey, ... } — whatever this chain needs
  return {
    kind: 'solana',
    chain: cfg.chain,
    name: cfg.name,
    walletAddress: /* base58 pubkey */,
    async init() { /* verify RPC genesis hash / cluster; warn on low SOL */ },
    async deliver(event) {
      // 1. Decode assetAddress: for Solana store the 32-byte mint pubkey in
      //    the ticket's `bytes assetAddress`; here decode hex -> base58.
      // 2. Resolve the destination — see "recipient vs data" below.
      // 3. Idempotency pre-check if possible (e.g. does our token account
      //    still hold the NFT?). Return { status: 'not_owned' } if gone.
      // 4. Send + confirm. Return { status: 'transferred', deliveryTxHash }
      //    or throw for retryable failures.
    },
  };
}
module.exports = { createSolanaHandler };
```

2. **Register it** in `crosschain/config.js` next to the existing comment
   placeholder:

```js
const { createSolanaHandler } = require('./chains/solana');
handlers.set('solana:mainnet', createSolanaHandler({ chain: 'solana:mainnet', name: 'Solana', ... }));
```

3. Add its env vars, fund the custody wallet, restart, mint with the new
   chain string.

### Recipient vs `data` on non-EVM chains — the critical nuance

The event's `recipient` is an **EVM address** (the ApeChain ticket holder). On
a non-EVM chain that address is meaningless — you cannot deliver to it. The
`data` field exists exactly for this: the redeemer supplies their destination
address (e.g. a Solana pubkey) in `data` at redeem time.

So a non-EVM handler MUST:

- Define and document its `data` encoding convention (recommendation: the raw
  32-byte pubkey for Solana; whatever is canonical + fixed-length for other
  chains). The frontend must encode it the same way at redeem time.
- Treat empty or undecodable `data` as a **terminal** failure — return
  something like `{ status: 'no_destination', error: '...' }`, don't throw
  (retrying cannot conjure a destination). The asset stays in custody; see
  "replaying" below for recovery after the user is contacted.
- Note the contract already guarantees non-empty `data` was set by the ticket
  holder personally (operators are blocked from passing data), so the
  destination is holder-authorized by construction.

The contract needs **no changes** for a new chain — `chain` is a free string
and `assetAddress` is free bytes. One caveat: `_mint` enforces 20-byte
addresses only for `eip155:*` chains; for a new chain family, decide the
`assetAddress` encoding, document it in `crosschain-admin-minting.md`, and
optionally add a matching length check in `_mint` (see `_isEvmChain` for the
prefix-match pattern).

## Tickets minted before the handler exists (parking + replay)

You can mint and even let users redeem tickets for a chain the worker doesn't
support yet. The event parks in the state file with
`status: 'unsupported_chain'` (loud log, no crash, no retry-loop, asset stays
in custody). After registering the handler, **delete that event's entry**
(keyed `txHash:logIndex`) from
`crosschain/state/crosschain-state-<contract>.json` and restart — the backfill
re-ingests and delivers it, provided the redeem is still within the 100k-block
(~2.3-day) backfill lookback. Older than that: restore delivery by
temporarily setting a lower `CROSSCHAIN_START_BLOCK` and deleting
`lastSeenBlock` from the state file, or handle it manually. Prefer registering
the handler BEFORE announcing prizes on a new chain.

## New-chain go-live checklist

1. Handler registered; `pm2 logs crosschain` boot shows the chain in
   `📇 registry:` and its `init()` checks passing.
2. Custody wallet on the new chain holds gas + one cheap test asset.
3. Mint a test ticket bound to that asset (`chain` string exact-matching the
   registry key) to a wallet you control.
4. Redeem it (with correctly-encoded `data` if non-EVM) and watch the logs
   through `[Redeemed] live` → `[transfer]` → `✅ mined`; confirm arrival
   on the destination chain and a `status: 'transferred'` state entry.
5. Kill and restart the worker, confirm the backfill does NOT re-deliver
   (dedupe holds).
6. Only then mint real prize tickets.
