# CrossChainNFT v2 — Admin Minting Guide

How to write to the CrossChainNFT contract: what every field means, what the
contract enforces, and exactly what an admin panel needs to do to mint
cross-chain prize tickets safely. Companion docs: `crosschain-v2-spec.md`
(system design) and `crosschain-adding-chains.md` (extending to new chains).

## Mental model

The contract (deployed on **ApeChain**) is a collection of transferable claim
tickets. Each ticket (tokenId) stores a `BridgedAsset` record saying exactly
which remote asset it redeems for. When a holder redeems, the ticket burns and
the droplet worker delivers the real asset from the custody wallet.

Two invariants the admin panel must respect, because the chain cannot check
them for you:

1. **Custody first.** The custody wallet (the `ETH_PRIVATE_KEY` wallet on the
   droplet) must already hold the asset before you mint a ticket for it. There
   is no on-chain proof of custody — a ticket for an asset we don't hold will
   burn on redeem and then fail delivery forever.
2. **One ticket per asset.** Nothing stops the owner minting two tickets
   pointing at the same NFT. The second redeemer gets a `not_owned` failure.
   The admin panel should track which custody assets already have tickets.

Only the contract **owner** can mint (`onlyOwner`).

## The BridgedAsset struct

```solidity
struct BridgedAsset {
    string  chain;         // CAIP-2 id, e.g. "eip155:1"
    bytes   assetAddress;  // 20-byte contract address for EVM chains
    uint256 assetTokenId;  // source NFT id; use 0 for ERC20
    bool    isERC20;       // false = NFT ticket, true = token-amount ticket
    uint256 amount;        // RAW token units if isERC20; MUST be 0 for NFTs
    string  metadataURI;   // per-token metadata pointer (may be "")
}
```

Field-by-field nuance:

### `chain`
- Must be the **exact** CAIP-2 string the worker has a handler registered for.
  Today that is only `"eip155:1"` (Ethereum mainnet). Case-sensitive, no
  whitespace. `"eip155:1 "` or `"ETH"` would mint fine but every redemption
  would park as `unsupported_chain`.
- The admin panel should use a dropdown of supported chains, never free text.

### `assetAddress`
- Solidity type is `bytes`, not `address`. In ethers/viem you pass the normal
  `0x…` 40-hex-char address string and it encodes as 20 bytes automatically.
- The contract **reverts** (`"Bad EVM address length"`) if `chain` starts with
  `eip155:` and this isn't exactly 20 bytes — so a padded/malformed address is
  caught at mint, not after the ticket burns.

### `assetTokenId`
- The tokenId of the source NFT (on the source chain). Unrelated to the local
  ticket tokenId.
- For ERC20 tickets it is ignored by the worker — set it to `0` by convention
  (not enforced on-chain).

### `isERC20` and `amount` — **the decimals trap**
- `amount` is **raw on-chain units**, exactly what the worker will pass to
  `transfer(recipient, amount)`. The worker never scales by decimals — it only
  reads `decimals()` to pretty-print its logs.
- The admin panel MUST convert: fetch `decimals()` from the token contract on
  the source chain, then store `parseUnits(humanAmount, decimals)`.
  - 500 USDC (6 decimals) → `500000000` (`500 * 10^6`)
  - 500 of an 18-decimal token → `500000000000000000000`
  - Minting `500` for USDC would pay the winner 0.0005 USDC.
- Contract validation: `isERC20 == true` requires `amount > 0`
  (`"Zero amount"`); `isERC20 == false` requires `amount == 0`
  (`"Amount for NFT"`).
- Show the human amount AND the raw amount side by side on the confirm screen.

### `metadataURI`
- Display-only pointer for our frontend. For NFT prizes, copy the original
  NFT's `tokenURI()` from the source chain so the ticket shows the real art.
- If empty, `tokenURI()` falls back to the collection baseURI convention
  (see `setBaseURI` below), so `""` is safe but ugly.
- For ERC20 prizes, point at a JSON you host describing the prize (name,
  image, amount). Standard ERC721 metadata shape.
- This is the ONLY field the owner can change after mint
  (`setTokenMetadataURI`) — and only while the ticket is unburned. The asset
  binding itself (chain/address/id/amount) is **immutable after mint**, by
  design: no setter exists.

## Choosing the local tokenId

The ticket's own tokenId is an arbitrary label — it does NOT need to match
`assetTokenId`. Rules:

- Reverts `"Already minted"` if the id currently exists.
- Reverts `"Already redeemed"` if the id was EVER redeemed — burned ids are
  permanently retired and can never be reused.
- Simplest admin-panel scheme: keep a monotonically increasing counter
  (max seen id + 1). To rebuild it from chain state, take the max over
  `tokensOfOwner(...)` of known holders plus `viewAllRedeemedTokenIds()`.

## Write functions

```solidity
mint(address to, uint256 tokenId, BridgedAsset asset)                  // one ticket
mintBatch(address to, uint256[] tokenIds, BridgedAsset[] assets)       // many tickets, one recipient
mintMany(address[] recipients, uint256[] tokenIds, BridgedAsset[] assets) // parallel arrays
```

Array lengths must match (`"Length mismatch"`). Every element goes through the
same per-ticket validation; one bad element reverts the whole batch. Each
ticket writes several storage strings, so gas-estimate large batches and chunk
them (25–50 per tx is comfortable).

### ethers v6 example (admin panel)

```js
const CROSSCHAIN_NFT_ADDRESS = '0x26c8F051acF2d898a0055Ed85c19a845Bcc5bE0F'; // ApeChain
const ABI = [
  'function mint(address to, uint256 tokenId, (string chain, bytes assetAddress, uint256 assetTokenId, bool isERC20, uint256 amount, string metadataURI) asset)',
  'function mintBatch(address to, uint256[] tokenIds, (string chain, bytes assetAddress, uint256 assetTokenId, bool isERC20, uint256 amount, string metadataURI)[] assets)',
  'function assetInfo(uint256 tokenId) view returns (tuple(string chain, bytes assetAddress, uint256 assetTokenId, bool isERC20, uint256 amount, string metadataURI))',
  'function exists(uint256 tokenId) view returns (bool)',
  'function isRedeemed(uint256 tokenId) view returns (bool)',
];
const nft = new ethers.Contract(CROSSCHAIN_NFT_ADDRESS, ABI, ownerSigner); // ApeChain signer

// NFT prize ticket (e.g. BAYC #4523):
await nft.mint(winner, 12, {
  chain: 'eip155:1',
  assetAddress: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', // encodes as 20 bytes
  assetTokenId: 4523n,
  isERC20: false,
  amount: 0n,
  metadataURI: originalTokenURI, // fetched from the BAYC contract on mainnet
});

// ERC20 prize ticket (500 USDC):
const usdc = new ethers.Contract(USDC, ['function decimals() view returns (uint8)'], mainnetProvider);
const raw = ethers.parseUnits('500', await usdc.decimals()); // 500000000n
await nft.mint(winner, 13, {
  chain: 'eip155:1',
  assetAddress: USDC,
  assetTokenId: 0n,
  isERC20: true,
  amount: raw,
  metadataURI: 'https://api.apechurch.io/prizes/usdc-500.json',
});
```

## Other owner functions

| Function | Purpose |
|---|---|
| `setTokenMetadataURI(id, uri)` | Fix a ticket's metadata pointer (unburned tickets only) |
| `setBaseURI(uri)` / `setURIExtention(ext)` | Fallback metadata for tickets with empty `metadataURI` |
| `setContractURI(uri)` | Collection-level metadata for marketplaces |
| `transferOwnership(addr)` | Standard ERC-173 |

## Redeem — what the user-facing side needs to know

- `redeem` is **overloaded**, so callers must name the full signature:
  `contract['redeem(uint256,bytes)'](id, '0x')` in ethers v6 (viem resolves by
  arg count). Empty `data` (`'0x'`) = deliver to the ticket holder — the
  normal case.
- `data` as a 20-byte address = deliver to that EVM address instead. Only the
  ticket **holder** may pass non-empty data (reverts
  `"Only holder can pass data"` for approved operators) — do not surface the
  alternate-address field to operators.
- Redeem is callable by holder, approved address, or operator; delivery always
  goes to the holder unless the holder itself set a data override.

## Reads for the admin panel

- `assetInfo(id)` — the full BridgedAsset; **works for burned tickets too**.
  A never-minted id returns an empty struct (detect via `chain == ""`).
- `exists(id)` / `isRedeemed(id)` — live vs burned vs never-minted.
- `tokensOfOwner(addr)`, `tokenOfOwnerByIndex(addr, i)`, `balanceOf(addr)`.
- `redeemedBy(id)`, `viewAllRedeemedTokenIds()` — redemption history.
- Delivery status is off-chain: the worker's state file on the droplet
  (`crosschain/state/crosschain-state-<contract>.json`) records per-redeem
  status (`transferred`, `not_owned`, `failed`, `unsupported_chain`, …) and
  the delivery tx hash.

## Mint-flow checklist (encode this in the admin panel)

1. Confirm the custody wallet holds the asset (`ownerOf` == custody wallet for
   NFTs; `balanceOf` ≥ total of all un-redeemed ERC20 tickets for that token —
   note multiple ERC20 tickets draw from the same balance).
2. Confirm no existing un-redeemed ticket already points at this NFT.
3. `chain` from a dropdown of worker-supported chains.
4. For ERC20: fetch `decimals()`, convert, show human + raw for confirmation.
5. For NFTs: fetch and copy the original `tokenURI()` into `metadataURI`.
6. Pick next free local tokenId.
7. Preview the exact `BridgedAsset` tuple, then send `mint` from the owner
   wallet on ApeChain.
8. After mint: read back `assetInfo(id)` and display it as written on-chain.
