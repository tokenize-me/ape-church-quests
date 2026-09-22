import { describe, expect, it } from 'vitest';
import { resolveCollectionName } from './compose';
import type { SweepDetected } from '../aggregator/types';

function sweepOf(
  collectionSlug: string,
  collectionName: string,
  tokenIds: string[] = ['27084'],
): SweepDetected {
  return {
    chain: 'ethereum',
    txHash: '0xtx',
    collectionSlug,
    collectionName,
    currency: 'ETH',
    decimals: 18,
    nfts: tokenIds.map((tokenId) => ({
      nftId: `ethereum/0xabc/${tokenId}`,
      tokenId,
      imageUrl: null,
      priceNative: 1,
    })),
    totalNative: tokenIds.length,
    averageNative: 1,
    timestamp: 0,
  };
}

describe('resolveCollectionName', () => {
  it('keeps a real token name as-is', () => {
    expect(resolveCollectionName(sweepOf('froglings', 'Frogling #42'), 'Froglings')).toBe('Frogling #42');
  });

  it('uses the override + token id when the token is named only "#<id>" (MAYC)', () => {
    expect(resolveCollectionName(sweepOf('mutant-ape-yacht-club', '#27084'), 'Mutant Ape Yacht Club'))
      .toBe('MAYC #27084');
  });

  it('treats an empty name or the slug fallback as unusable', () => {
    expect(resolveCollectionName(sweepOf('mutant-ape-yacht-club', ''), null)).toBe('MAYC #27084');
    expect(resolveCollectionName(sweepOf('mutant-ape-yacht-club', 'mutant-ape-yacht-club'), null))
      .toBe('MAYC #27084');
  });

  it('uses the OpenSea display name when there is no override', () => {
    expect(resolveCollectionName(sweepOf('sloooths', '#515', ['515']), 'Sloooths')).toBe('Sloooths #515');
  });

  it('uses just the collection name for a multi-NFT sweep', () => {
    expect(resolveCollectionName(sweepOf('sloooths', '#515', ['515', '516']), 'Sloooths')).toBe('Sloooths');
  });

  it('falls back to a prettified slug when OpenSea has no display name', () => {
    expect(resolveCollectionName(sweepOf('cool-cats', '#1', ['1']), null)).toBe('Cool Cats #1');
  });

  it('leaves very long (ERC-1155 style) token ids off the label', () => {
    const longId = '81146772462531016887270664967342334461426609';
    expect(resolveCollectionName(sweepOf('some-1155', '', [longId]), 'Some Items')).toBe('Some Items');
  });
});
