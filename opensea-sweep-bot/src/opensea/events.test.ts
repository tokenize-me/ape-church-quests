import { describe, expect, it } from 'vitest';
import { toSaleEvent, type OpenSeaSaleEvent } from './events';
import { DEPLOYER_ADDRESS } from '../config';

function rawSale(overrides: Partial<OpenSeaSaleEvent> = {}): OpenSeaSaleEvent {
  return {
    event_type: 'sale',
    event_timestamp: 1790110535,
    transaction: '0xtx',
    order_hash: '',
    chain: 'ape_chain',
    payment: { quantity: '100000000000000000000', decimals: 18, symbol: 'APE' },
    seller: '0xSELLER',
    buyer: DEPLOYER_ADDRESS,
    nft: {
      identifier: '42',
      collection: 'froglings',
      contract: '0xABC',
      name: 'Frogling #42',
      image_url: 'https://i.seadn.io/raw.png',
      display_image_url: 'https://i2c.seadn.io/display.png',
    },
    ...overrides,
  };
}

describe('toSaleEvent', () => {
  it('maps a REST sale into the stream SaleEvent shape', () => {
    const e = toSaleEvent(rawSale(), DEPLOYER_ADDRESS);
    expect(e).toEqual({
      chain: 'ape_chain',
      txHash: '0xtx',
      nftId: 'ape_chain/0xabc/42',
      orderHash: '',
      buyer: DEPLOYER_ADDRESS,
      seller: '0xseller',
      collectionSlug: 'froglings',
      collectionName: 'Frogling #42',
      tokenId: '42',
      contractAddress: '0xabc',
      imageUrl: 'https://i2c.seadn.io/display.png',
      priceNative: 100,
      currency: 'APE',
      decimals: 18,
      timestamp: 1790110535,
    });
  });

  it('falls back to the slug when the NFT has no name', () => {
    const raw = rawSale();
    const e = toSaleEvent({ ...raw, nft: { ...raw.nft!, name: '' } }, DEPLOYER_ADDRESS);
    expect(e?.collectionName).toBe('froglings');
  });

  it('matches the buyer case-insensitively', () => {
    expect(toSaleEvent(rawSale({ buyer: DEPLOYER_ADDRESS.toUpperCase() }), DEPLOYER_ADDRESS)).not.toBeNull();
  });

  it('drops sales the live bot would drop', () => {
    expect(toSaleEvent(rawSale({ buyer: '0xstranger' }), DEPLOYER_ADDRESS)).toBeNull();
    expect(toSaleEvent(rawSale({ chain: 'base' }), DEPLOYER_ADDRESS)).toBeNull();
    expect(toSaleEvent(rawSale({ event_type: 'transfer' }), DEPLOYER_ADDRESS)).toBeNull();
    expect(toSaleEvent(rawSale({ payment: null }), DEPLOYER_ADDRESS)).toBeNull();
    expect(toSaleEvent(rawSale({ nft: null }), DEPLOYER_ADDRESS)).toBeNull();
  });
});
