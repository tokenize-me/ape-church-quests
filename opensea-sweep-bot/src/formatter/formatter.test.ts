import { describe, expect, it } from 'vitest';
import { displayDecimals, formatCount, formatNative } from './format-helpers';
import { buildTweet, deriveCollectionGroupName } from './tweet';
import type { SweepDetected } from '../aggregator/types';

describe('formatNative', () => {
  it('formats APE with 2 decimals and comma thousands', () => {
    expect(formatNative(1750, 'APE')).toBe('1,750.00');
    expect(formatNative(87.5, 'APE')).toBe('87.50');
    expect(formatNative(0, 'APE')).toBe('0.00');
  });

  it('formats ETH with 4 decimals and comma thousands', () => {
    expect(formatNative(0.025, 'ETH')).toBe('0.0250');
    expect(formatNative(1.23456789, 'ETH')).toBe('1.2346');
    expect(formatNative(1234.5, 'ETH')).toBe('1,234.5000');
  });

  it('treats WETH like ETH and WAPE like APE', () => {
    expect(formatNative(0.025, 'WETH')).toBe('0.0250');
    expect(formatNative(87.5, 'WAPE')).toBe('87.50');
  });

  it('formats stablecoins with 2 decimals', () => {
    expect(formatNative(1500, 'USDC')).toBe('1,500.00');
    expect(formatNative(1500, 'USDT')).toBe('1,500.00');
  });

  it('falls back to 4 decimals for unknown symbols', () => {
    expect(formatNative(1.5, 'WIF')).toBe('1.5000');
  });

  it('is case-insensitive on the currency symbol', () => {
    expect(formatNative(1750, 'ape')).toBe('1,750.00');
    expect(formatNative(0.025, 'eth')).toBe('0.0250');
  });

  it('rounds half-up via toLocaleString defaults', () => {
    expect(formatNative(0.12345, 'ETH')).toBe('0.1235');
  });
});

describe('displayDecimals', () => {
  it('returns 4 for ETH/WETH', () => {
    expect(displayDecimals('ETH')).toBe(4);
    expect(displayDecimals('WETH')).toBe(4);
  });
  it('returns 2 for APE/USDC', () => {
    expect(displayDecimals('APE')).toBe(2);
    expect(displayDecimals('USDC')).toBe(2);
  });
  it('returns 4 by default', () => {
    expect(displayDecimals('PEPE')).toBe(4);
  });
});

describe('deriveCollectionGroupName', () => {
  it('strips trailing "[ ]#NNN" patterns', () => {
    expect(deriveCollectionGroupName('DSNR #5561', 'dsnr')).toBe('DSNR');
    expect(deriveCollectionGroupName('BAYC #1234', 'bayc')).toBe('BAYC');
    expect(deriveCollectionGroupName('Doodles #56', 'doodles')).toBe('Doodles');
  });

  it('strips trailing space+digits (no #)', () => {
    expect(deriveCollectionGroupName('Doodles 56', 'doodles')).toBe('Doodles');
    expect(deriveCollectionGroupName('Cool Cat 5', 'cool-cats')).toBe('Cool Cat');
  });

  it('returns the name unchanged when there is no token suffix', () => {
    expect(deriveCollectionGroupName('Cool Cats', 'cool-cats')).toBe('Cool Cats');
    expect(deriveCollectionGroupName('BAYC', 'bored-ape-yacht-club')).toBe('BAYC');
  });

  it('prettifies the slug when itemName fell back to the slug (parser fallback)', () => {
    expect(deriveCollectionGroupName('dengs', 'dengs')).toBe('Dengs');
    expect(deriveCollectionGroupName('bored-ape-yacht-club', 'bored-ape-yacht-club')).toBe(
      'Bored Ape Yacht Club',
    );
  });

  it('does not strip when the result would be empty', () => {
    expect(deriveCollectionGroupName('12345', 'whatever')).toBe('12345');
  });
});

describe('formatCount', () => {
  it('renders small counts without a separator', () => {
    expect(formatCount(1)).toBe('1');
    expect(formatCount(25)).toBe('25');
    expect(formatCount(999)).toBe('999');
  });
  it('adds a comma at and above 1000', () => {
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(1250)).toBe('1,250');
    expect(formatCount(1_250_000)).toBe('1,250,000');
  });
});

describe('buildTweet', () => {
  it('renders the single-NFT template', () => {
    const sweep = makeSweep({
      nfts: [nft(0.5)],
      totalNative: 0.5,
      averageNative: 0.5,
      collectionName: 'Cool Cats',
      currency: 'ETH',
    });
    expect(buildTweet(sweep).text).toBe(
      'ApeChurch Deployer picked up a Cool Cats for 0.5000 ETH.',
    );
  });

  it('renders the multi-NFT template with both {currency} placeholders filled', () => {
    const sweep = makeSweep({
      nfts: [nft(100), nft(100), nft(100), nft(100), nft(100)],
      totalNative: 500,
      averageNative: 100,
      collectionName: 'BAYC',
      currency: 'APE',
    });
    expect(buildTweet(sweep).text).toBe(
      'ApeChurch Deployer has swept 5 BAYC NFTs for a total cost of 500.00 APE, purchasing each NFT at an average price of 100.00 APE.',
    );
  });

  it('strips the token-id suffix from collection name in multi-NFT tweets', () => {
    const sweep = makeSweep({
      nfts: [nft(116), nft(116), nft(116), nft(116), nft(116), nft(116), nft(116), nft(116)],
      totalNative: 928,
      averageNative: 116,
      collectionName: 'DSNR #5561',
      currency: 'APE',
    });
    expect(buildTweet(sweep).text).toBe(
      'ApeChurch Deployer has swept 8 DSNR NFTs for a total cost of 928.00 APE, purchasing each NFT at an average price of 116.00 APE.',
    );
  });

  it('keeps the full token name in single-NFT tweets', () => {
    const sweep = makeSweep({
      nfts: [nft(116)],
      totalNative: 116,
      averageNative: 116,
      collectionName: 'DSNR #5561',
      currency: 'APE',
    });
    expect(buildTweet(sweep).text).toBe(
      'ApeChurch Deployer picked up a DSNR #5561 for 116.00 APE.',
    );
  });

  it('appends @handle to single-NFT tweet when handle is provided', () => {
    const sweep = makeSweep({
      nfts: [nft(116)],
      totalNative: 116,
      averageNative: 116,
      collectionName: 'DSNR #5561',
      currency: 'APE',
    });
    expect(buildTweet(sweep, 'dengsnft').text).toBe(
      'ApeChurch Deployer picked up a DSNR #5561 for 116.00 APE. @dengsnft',
    );
  });

  it('appends @handle to multi-NFT tweet when handle is provided', () => {
    const sweep = makeSweep({
      nfts: [nft(116), nft(116), nft(116), nft(116), nft(116)],
      totalNative: 580,
      averageNative: 116,
      collectionName: 'DSNR #5561',
      currency: 'APE',
    });
    expect(buildTweet(sweep, 'dengsnft').text).toBe(
      'ApeChurch Deployer has swept 5 DSNR NFTs for a total cost of 580.00 APE, purchasing each NFT at an average price of 116.00 APE. @dengsnft',
    );
  });

  it('strips a leading @ from the handle if present', () => {
    const sweep = makeSweep({
      nfts: [nft(1)],
      totalNative: 1,
      averageNative: 1,
      collectionName: 'X',
      currency: 'ETH',
    });
    expect(buildTweet(sweep, '@dengsnft').text).toContain('@dengsnft');
    expect(buildTweet(sweep, '@dengsnft').text).not.toContain('@@');
  });

  it('does not append anything when handle is null/undefined/empty', () => {
    const sweep = makeSweep({ nfts: [nft(1)], totalNative: 1, averageNative: 1, collectionName: 'X', currency: 'ETH' });
    expect(buildTweet(sweep, null).text.endsWith('.')).toBe(true);
    expect(buildTweet(sweep, undefined).text.endsWith('.')).toBe(true);
    expect(buildTweet(sweep, '').text.endsWith('.')).toBe(true);
    expect(buildTweet(sweep, '   ').text.endsWith('.')).toBe(true);
  });

  it('comma-separates large NFT counts', () => {
    const nfts = Array.from({ length: 1234 }, () => nft(1));
    const sweep = makeSweep({
      nfts,
      totalNative: 1234,
      averageNative: 1,
      collectionName: 'Spam Collection',
      currency: 'APE',
    });
    expect(buildTweet(sweep).text).toContain('swept 1,234 Spam Collection NFTs');
    expect(buildTweet(sweep).text).toContain('1,234.00 APE');
  });

  it('passes through arbitrary currency symbols (WETH/USDC/etc.)', () => {
    const sweep = makeSweep({
      nfts: [nft(0.4), nft(0.4)],
      totalNative: 0.8,
      averageNative: 0.4,
      collectionName: 'Cool',
      currency: 'WETH',
    });
    expect(buildTweet(sweep).text).toContain('0.8000 WETH');
    expect(buildTweet(sweep).text).toContain('0.4000 WETH');
  });
});

function makeSweep(overrides: Partial<SweepDetected>): SweepDetected {
  return {
    chain: 'ethereum',
    txHash: '0xtx',
    collectionSlug: 'cool',
    collectionName: 'Cool',
    currency: 'ETH',
    decimals: 18,
    nfts: [nft(1)],
    totalNative: 1,
    averageNative: 1,
    timestamp: 1000,
    ...overrides,
  };
}

function nft(price: number): SweepDetected['nfts'][number] {
  return { nftId: `a/${Math.random()}`, tokenId: '1', imageUrl: null, priceNative: price };
}
