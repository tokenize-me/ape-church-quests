import { describe, expect, it, vi } from 'vitest';
import { parseItemSoldEvent } from './parser';
import { applyFilters, type FilterDeps } from './manager';
import { DEPLOYER_ADDRESS } from '../config';
import type { ItemSoldEvent } from '@opensea/stream-js';

function rawEvent(overrides: Partial<ItemSoldEvent['payload']> = {}): ItemSoldEvent {
  const base: ItemSoldEvent['payload'] = {
    chain: 'ethereum',
    item: {
      nft_id: 'ethereum/0xabc/42',
      permalink: 'https://opensea.io/x',
      chain: { name: 'ethereum' },
      metadata: {
        name: 'Cool #42',
        image_url: 'https://i.seadn.io/img.png',
        animation_url: null,
        metadata_url: null,
      },
    },
    collection: { slug: 'cool-collection' },
    quantity: 1,
    listing_type: 'english',
    closing_date: '2026-05-11T12:00:00Z',
    transaction: { hash: '0xtxhash', timestamp: '2026-05-11T12:00:00Z' },
    maker: { address: '0xSeller' },
    taker: { address: '0xBUYER' },
    order_hash: '0xorder',
    sale_price: '500000000000000000', // 0.5 ETH in wei
    payment_token: {
      address: '0x0',
      decimals: 18,
      eth_price: '1',
      name: 'Ether',
      symbol: 'ETH',
      usd_price: '3000',
    },
    is_private: false,
    event_timestamp: '2026-05-11T12:00:00Z',
    ...overrides,
  } as ItemSoldEvent['payload'];
  return {
    event_type: 'item_sold',
    version: 1,
    sent_at: '2026-05-11T12:00:00Z',
    payload: base,
  };
}

describe('parseItemSoldEvent', () => {
  it('parses a well-formed Ethereum sale', () => {
    const result = parseItemSoldEvent(rawEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.chain).toBe('ethereum');
    expect(result.event.txHash).toBe('0xtxhash');
    expect(result.event.nftId).toBe('ethereum/0xabc/42');
    expect(result.event.contractAddress).toBe('0xabc');
    expect(result.event.tokenId).toBe('42');
    expect(result.event.buyer).toBe('0xbuyer');
    expect(result.event.seller).toBe('0xseller');
    expect(result.event.collectionSlug).toBe('cool-collection');
    expect(result.event.collectionName).toBe('Cool #42');
    expect(result.event.imageUrl).toBe('https://i.seadn.io/img.png');
    expect(result.event.priceNative).toBe(0.5);
    expect(result.event.currency).toBe('ETH');
    expect(result.event.decimals).toBe(18);
    expect(result.event.timestamp).toBe(Math.floor(Date.parse('2026-05-11T12:00:00Z') / 1000));
  });

  it('falls back to collection slug when metadata.name is missing', () => {
    const result = parseItemSoldEvent(
      rawEvent({
        item: {
          nft_id: 'ethereum/0xabc/42',
          permalink: 'p',
          chain: { name: 'ethereum' },
          metadata: { name: null, image_url: null, animation_url: null, metadata_url: null },
        },
      } as Partial<ItemSoldEvent['payload']>),
    );
    expect(result.ok && result.event.collectionName).toBe('cool-collection');
  });

  it('handles APE (18-decimal) payment token', () => {
    const result = parseItemSoldEvent(
      rawEvent({
        chain: 'ape_chain',
        sale_price: '100000000000000000000',
        payment_token: {
          address: '0x0',
          decimals: 18,
          eth_price: '0',
          name: 'ApeCoin',
          symbol: 'APE',
          usd_price: '1',
        },
      } as Partial<ItemSoldEvent['payload']>),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.chain).toBe('ape_chain');
    expect(result.event.priceNative).toBe(100);
    expect(result.event.currency).toBe('APE');
  });

  it('handles USDC (6-decimal) payment token', () => {
    const result = parseItemSoldEvent(
      rawEvent({
        sale_price: '1500000000',
        payment_token: {
          address: '0x0',
          decimals: 6,
          eth_price: '0',
          name: 'USD Coin',
          symbol: 'USDC',
          usd_price: '1',
        },
      } as Partial<ItemSoldEvent['payload']>),
    );
    expect(result.ok && result.event.priceNative).toBe(1500);
    expect(result.ok && result.event.currency).toBe('USDC');
    expect(result.ok && result.event.decimals).toBe(6);
  });

  it('reports nft_id_format with chain when nft_id has fewer than 3 parts', () => {
    const result = parseItemSoldEvent(
      rawEvent({ chain: 'solana', item: { ...rawEvent().payload.item, nft_id: 'solana/mint' } } as Partial<ItemSoldEvent['payload']>),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('nft_id_format');
    expect(result.chain).toBe('solana');
  });

  it('reports missing_sale_price with chain', () => {
    const result = parseItemSoldEvent(rawEvent({ sale_price: '' } as Partial<ItemSoldEvent['payload']>));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_sale_price');
  });

  it('reports unparseable_timestamp', () => {
    const result = parseItemSoldEvent(
      rawEvent({ event_timestamp: 'not-a-date', transaction: { hash: '0xt', timestamp: 'also-bad' } } as Partial<ItemSoldEvent['payload']>),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unparseable_timestamp');
  });

  it('reports missing_chain when chain field is absent', () => {
    const p = rawEvent().payload;
    const broken: ItemSoldEvent = {
      event_type: 'item_sold',
      version: 1,
      sent_at: 'x',
      payload: { ...p, chain: undefined as unknown as string, item: { ...p.item, chain: undefined as unknown as { name: string } } },
    };
    const result = parseItemSoldEvent(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing_chain');
      expect(result.chain).toBeUndefined();
    }
  });

  it('lowercases addresses (buyer/seller)', () => {
    const result = parseItemSoldEvent(
      rawEvent({
        maker: { address: '0xABCDEF' },
        taker: { address: '0x123456' },
      } as Partial<ItemSoldEvent['payload']>),
    );
    expect(result.ok && result.event.seller).toBe('0xabcdef');
    expect(result.ok && result.event.buyer).toBe('0x123456');
  });
});

describe('applyFilters', () => {
  const baseDeps = (): FilterDeps => ({
    isEventProcessed: vi.fn().mockReturnValue(false),
    markEventProcessed: vi.fn(),
    deployerAddress: DEPLOYER_ADDRESS,
    acceptedChains: ['ethereum', 'ape_chain'],
  });

  const parsedFor = (overrides: Record<string, unknown> = {}) => ({
    chain: 'ethereum',
    txHash: '0xtx',
    nftId: 'ethereum/0xabc/42',
    orderHash: '0xorder',
    buyer: DEPLOYER_ADDRESS,
    seller: '0xseller',
    collectionSlug: 'cool',
    collectionName: 'Cool',
    tokenId: '42',
    contractAddress: '0xabc',
    imageUrl: null,
    priceNative: 0.5,
    currency: 'ETH',
    decimals: 18,
    timestamp: 1000,
    ...overrides,
  });

  it('forwards when chain, buyer, and dedup all pass', () => {
    const deps = baseDeps();
    const outcome = applyFilters(parsedFor(), deps);
    expect(outcome.decision).toBe('forward');
    expect(deps.markEventProcessed).toHaveBeenCalledOnce();
  });

  it('drops events from non-accepted chains', () => {
    const deps = baseDeps();
    const outcome = applyFilters(parsedFor({ chain: 'base' }), deps);
    expect(outcome.decision).toBe('drop');
    if (outcome.decision === 'drop') expect(outcome.reason).toBe('chain');
    expect(deps.markEventProcessed).not.toHaveBeenCalled();
  });

  it('drops events where the buyer is not the deployer', () => {
    const deps = baseDeps();
    const outcome = applyFilters(parsedFor({ buyer: '0xstranger' }), deps);
    expect(outcome.decision).toBe('drop');
    if (outcome.decision === 'drop') expect(outcome.reason).toBe('buyer');
    expect(deps.markEventProcessed).not.toHaveBeenCalled();
  });

  it('drops already-processed events without marking again', () => {
    const deps = baseDeps();
    (deps.isEventProcessed as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const outcome = applyFilters(parsedFor(), deps);
    expect(outcome.decision).toBe('drop');
    if (outcome.decision === 'drop') expect(outcome.reason).toBe('duplicate');
    expect(deps.markEventProcessed).not.toHaveBeenCalled();
  });

  it('does case-insensitive buyer comparison', () => {
    const deps = baseDeps();
    const outcome = applyFilters(
      parsedFor({ buyer: DEPLOYER_ADDRESS.toLowerCase() }),
      { ...deps, deployerAddress: DEPLOYER_ADDRESS.toUpperCase() },
    );
    expect(outcome.decision).toBe('forward');
  });
});
