import type { ItemSoldEvent } from '@opensea/stream-js';

export interface ParsedSaleEvent {
  chain: string;
  txHash: string;
  nftId: string;
  orderHash: string;
  buyer: string;
  seller: string;
  collectionSlug: string;
  collectionName: string;
  tokenId: string;
  contractAddress: string;
  imageUrl: string | null;
  priceNative: number;
  currency: string;
  decimals: number;
  timestamp: number;
}

export type ParseFailureReason =
  | 'missing_payload'
  | 'missing_chain'
  | 'missing_tx_hash'
  | 'missing_nft_id'
  | 'nft_id_format'
  | 'missing_addresses'
  | 'missing_collection_slug'
  | 'missing_payment_token'
  | 'missing_sale_price'
  | 'price_not_finite'
  | 'unparseable_timestamp';

export type ParseResult =
  | { ok: true; event: ParsedSaleEvent }
  | { ok: false; reason: ParseFailureReason; chain?: string };

export function parseItemSoldEvent(raw: ItemSoldEvent): ParseResult {
  const p = raw?.payload;
  if (!p) return { ok: false, reason: 'missing_payload' };

  // Extract chain FIRST so failure reports tell us which chain is failing.
  const chain = p.chain ?? p.item?.chain?.name;
  if (!chain || typeof chain !== 'string') {
    return { ok: false, reason: 'missing_chain' };
  }

  const txHash = p.transaction?.hash;
  if (!txHash) return { ok: false, reason: 'missing_tx_hash', chain };

  const nftId = p.item?.nft_id;
  if (!nftId) return { ok: false, reason: 'missing_nft_id', chain };

  const parts = nftId.split('/');
  if (parts.length < 3) return { ok: false, reason: 'nft_id_format', chain };
  const contractAddress = parts[1]!;
  const tokenId = parts.slice(2).join('/');

  const buyerAddr = p.taker?.address;
  const sellerAddr = p.maker?.address;
  if (!buyerAddr || !sellerAddr) {
    return { ok: false, reason: 'missing_addresses', chain };
  }

  const collectionSlug = p.collection?.slug;
  if (!collectionSlug) return { ok: false, reason: 'missing_collection_slug', chain };

  const pt = p.payment_token;
  if (!pt || typeof pt.decimals !== 'number' || !pt.symbol) {
    return { ok: false, reason: 'missing_payment_token', chain };
  }

  const salePriceRaw = p.sale_price;
  if (salePriceRaw === undefined || salePriceRaw === null || salePriceRaw === '') {
    return { ok: false, reason: 'missing_sale_price', chain };
  }
  const priceNative = Number(salePriceRaw) / 10 ** pt.decimals;
  if (!Number.isFinite(priceNative)) {
    return { ok: false, reason: 'price_not_finite', chain };
  }

  const eventTs = p.event_timestamp ?? p.transaction?.timestamp;
  const timestampMs = eventTs ? Date.parse(eventTs) : NaN;
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: 'unparseable_timestamp', chain };
  }

  return {
    ok: true,
    event: {
      chain,
      txHash,
      nftId,
      orderHash: p.order_hash ?? '',
      buyer: buyerAddr.toLowerCase(),
      seller: sellerAddr.toLowerCase(),
      collectionSlug,
      collectionName: p.item?.metadata?.name ?? collectionSlug,
      tokenId,
      contractAddress,
      imageUrl: p.item?.metadata?.image_url ?? null,
      priceNative,
      currency: pt.symbol,
      decimals: pt.decimals,
      timestamp: Math.floor(timestampMs / 1000),
    },
  };
}
