import type { SweepDetected } from '../aggregator/types';
import { MAX_COLLAGE_IMAGES } from '../config';

export function selectImagesToShow(sweep: SweepDetected): string[] {
  const urls: string[] = [];
  for (const nft of sweep.nfts) {
    if (urls.length >= MAX_COLLAGE_IMAGES) break;
    if (nft.imageUrl) urls.push(nft.imageUrl);
  }
  return urls;
}
