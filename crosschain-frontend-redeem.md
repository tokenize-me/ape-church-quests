# CrossChainNFT v2 — Frontend: Fetching & Redeeming Tickets

What the Dashboard (and the NFT Pack win screen) needs: show the user's
cross-chain tickets with their metadata, and a Redeem Modal that burns the
ticket. All reads/writes go to the CrossChainNFT contract on **ApeChain**.
After the burn, delivery of the real asset is automatic (an off-chain worker
watches the event and sends it on the source chain) — the frontend does
nothing else.

## ABI fragments

```js
const CROSSCHAIN_NFT_ADDRESS = '0x26c8F051acF2d898a0055Ed85c19a845Bcc5bE0F'; // ApeChain
const ABI = [
  'function tokensOfOwner(address owner) view returns (uint256[])',
  'function assetInfo(uint256 tokenId) view returns (tuple(string chain, bytes assetAddress, uint256 assetTokenId, bool isERC20, uint256 amount, string metadataURI))',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function isRedeemed(uint256 tokenId) view returns (bool)',
  'function redeem(uint256 tokenId)',
  'function redeem(uint256 tokenId, bytes data)',
];
```

## Fetching the user's tickets + metadata

```js
const nft = new ethers.Contract(CROSSCHAIN_NFT_ADDRESS, ABI, apechainProvider);

const ids = await nft.tokensOfOwner(userAddress); // usually 0 or 1
const tickets = await Promise.all(ids.map(async (id) => {
  const [asset, uri] = await Promise.all([nft.assetInfo(id), nft.tokenURI(id)]);
  return { id, asset, uri };
}));
```

- `tokenURI(id)` already returns the per-ticket metadata pointer (set at mint,
  usually the original NFT's own tokenURI), falling back to the collection
  baseURI if none was set. Fetch that URL for the standard `{ name, image, … }`
  JSON to render the card (translate `ipfs://` to your gateway as usual).
- `assetInfo(id)` tells you what the ticket redeems for:
  - `chain` — CAIP-2 string; `"eip155:1"` = Ethereum mainnet. Display as the
    destination chain.
  - `isERC20` — `false`: an NFT (`assetAddress` + `assetTokenId`); `true`: a
    token amount. `amount` is **raw units** — to show a human number, read
    `decimals()` from the token contract on the source chain (or just render
    from the metadata JSON, which is simpler).

## Redeem Modal

Behavior: default destination is the connected wallet; an "advanced" field
lets the user enter a different address. Validate before sending.

```js
const nft = new ethers.Contract(CROSSCHAIN_NFT_ADDRESS, ABI, apechainSigner);

async function redeemTicket(tokenId, customAddress /* '' when untouched */) {
  const useCustom =
    customAddress &&
    customAddress.toLowerCase() !== userAddress.toLowerCase();

  if (useCustom && !ethers.isAddress(customAddress)) {
    throw new Error('Invalid destination address'); // block the tx, show in modal
  }

  // redeem is overloaded — MUST select by full signature.
  return useCustom
    ? nft['redeem(uint256,bytes)'](tokenId, ethers.getAddress(customAddress)) // 20-byte data
    : nft['redeem(uint256)'](tokenId); // delivery goes to the ticket holder
}
```

Rules to respect in the modal:

- **Default path (no custom address): call `redeem(uint256)`** (or pass `'0x'`
  data — same thing). Delivery goes to the ticket holder's address on the
  destination chain automatically; the user does not need to type anything.
- **Custom address**: validated with `ethers.isAddress`, checksummed with
  `ethers.getAddress`, passed as the `data` bytes (an address string encodes
  as exactly 20 bytes, which is what the worker expects). Reject the zero
  address. Warn that the asset will be sent to that address on the
  destination chain (Ethereum), not on ApeChain.
- The contract only accepts non-empty `data` from the ticket **holder** — the
  connected wallet in this flow — so this works as-is; just don't build a
  redeem-on-behalf/operator flow with a custom address, it will revert
  (`"Only holder can pass data"`).
- If a ticket for a non-EVM chain ever exists (`chain` not starting with
  `eip155:`), an EVM address is not a valid destination there — hide the
  modal's default and require a destination in that chain's format. Encoding
  convention TBD per chain; not needed for anything live today.

## After the tx confirms

- The ticket is burned: it disappears from `tokensOfOwner`, `isRedeemed(id)`
  is `true`, and a `Redeemed` event was emitted. `assetInfo(id)` still works
  after the burn if you want a "recently redeemed" display.
- Show a success state like "Your prize is on its way on Ethereum" — the
  worker typically delivers within a couple of minutes; there is no on-chain
  signal on ApeChain when delivery lands, so don't try to await it.
