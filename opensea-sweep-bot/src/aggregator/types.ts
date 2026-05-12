import type { AcceptedChain } from '../config';

export interface SaleEvent {
  chain: AcceptedChain;
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

export interface SweepDetected {
  chain: AcceptedChain;
  txHash: string;
  collectionSlug: string;
  collectionName: string;
  currency: string;
  decimals: number;
  nfts: Array<{
    nftId: string;
    tokenId: string;
    imageUrl: string | null;
    priceNative: number;
  }>;
  totalNative: number;
  averageNative: number;
  timestamp: number;
}
