import { ACCEPTED_CHAINS, type AcceptedChain } from '../config';
import type { SaleEvent } from '../aggregator/types';

// Shape of one row from GET /api/v2/events/accounts/{address}?event_type=sale.
// Only the fields we read are typed.
export interface OpenSeaSaleEvent {
  event_type: string;
  event_timestamp: number; // unix seconds
  transaction: string;
  order_hash?: string | null;
  chain: string;
  payment?: { quantity: string; decimals: number; symbol: string } | null;
  seller: string;
  buyer: string;
  nft?: {
    identifier: string;
    collection: string;
    contract: string;
    name?: string | null;
    image_url?: string | null;
    display_image_url?: string | null;
  } | null;
}

const EVENTS_PAGE_LIMIT = 50;
const EVENTS_TIMEOUT_MS = 15_000;

// All OpenSea sales in [sinceUnix, untilUnix) where `buyer` bought, on the
// chains the bot announces. Oldest first. Used by the backfill script — the
// live bot gets the same data from the Stream API instead.
export async function fetchPurchases(
  buyer: string,
  sinceUnix: number,
  untilUnix: number,
  apiKey: string,
): Promise<SaleEvent[]> {
  const out: SaleEvent[] = [];
  let next: string | null = null;
  do {
    const params = new URLSearchParams({
      event_type: 'sale',
      after: String(sinceUnix),
      before: String(untilUnix),
      limit: String(EVENTS_PAGE_LIMIT),
    });
    if (next) params.set('next', next);
    const url = `https://api.opensea.io/api/v2/events/accounts/${buyer}?${params}`;
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(EVENTS_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`OpenSea events HTTP ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      asset_events?: OpenSeaSaleEvent[];
      next?: string | null;
    };
    for (const raw of data.asset_events ?? []) {
      const event = toSaleEvent(raw, buyer);
      if (event) out.push(event);
    }
    next = data.next ?? null;
  } while (next);

  return out.sort((a, b) => a.timestamp - b.timestamp);
}

// Converts a REST sale row into the SaleEvent shape the stream parser emits,
// so buildSweep/buildTweet treat backfilled sweeps exactly like live ones.
// Returns null for rows the live bot would have dropped.
export function toSaleEvent(raw: OpenSeaSaleEvent, buyer: string): SaleEvent | null {
  if (raw.event_type !== 'sale') return null;
  if (!ACCEPTED_CHAINS.includes(raw.chain as AcceptedChain)) return null;
  if (raw.buyer?.toLowerCase() !== buyer.toLowerCase()) return null;
  const nft = raw.nft;
  const pt = raw.payment;
  if (!nft || !pt || typeof pt.decimals !== 'number' || !pt.symbol) return null;

  const priceNative = Number(pt.quantity) / 10 ** pt.decimals;
  if (!Number.isFinite(priceNative)) return null;

  const contractAddress = nft.contract.toLowerCase();
  return {
    chain: raw.chain as AcceptedChain,
    txHash: raw.transaction,
    nftId: `${raw.chain}/${contractAddress}/${nft.identifier}`,
    orderHash: raw.order_hash ?? '',
    buyer: raw.buyer.toLowerCase(),
    seller: raw.seller.toLowerCase(),
    collectionSlug: nft.collection,
    // Same fallback as the stream parser; buildSweepText swaps in the
    // collection's name when the token has no usable one.
    collectionName: nft.name?.trim() || nft.collection,
    tokenId: nft.identifier,
    contractAddress,
    imageUrl: nft.display_image_url || nft.image_url || null,
    priceNative,
    currency: pt.symbol,
    decimals: pt.decimals,
    timestamp: raw.event_timestamp,
  };
}
