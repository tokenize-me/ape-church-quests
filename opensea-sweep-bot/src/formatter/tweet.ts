import type { SweepDetected } from '../aggregator/types';
import { TWEET_TEMPLATES } from '../config';
import { formatCount, formatNative } from './format-helpers';

export function buildTweet(
  sweep: SweepDetected,
  twitterHandle?: string | null,
): { text: string } {
  let text: string;
  if (sweep.nfts.length === 1) {
    text = TWEET_TEMPLATES.single
      .replace('{collectionName}', sweep.collectionName)
      .replace('{price}', formatNative(sweep.totalNative, sweep.currency))
      .replace('{currency}', sweep.currency);
  } else {
    const groupName = deriveCollectionGroupName(
      sweep.collectionName,
      sweep.collectionSlug,
    );
    text = TWEET_TEMPLATES.multi
      .replace('{count}', formatCount(sweep.nfts.length))
      .replace('{collectionName}', groupName)
      .replace('{total}', formatNative(sweep.totalNative, sweep.currency))
      .replace('{average}', formatNative(sweep.averageNative, sweep.currency))
      .replaceAll('{currency}', sweep.currency);
  }

  if (twitterHandle && twitterHandle.trim().length > 0) {
    text = `${text} @${twitterHandle.trim().replace(/^@/, '')}`;
  }

  return { text };
}

/**
 * For multi-NFT sweeps, the per-token `metadata.name` (e.g. "DSNR #5561")
 * leaks the first NFT's token ID into the tweet. Strip the trailing
 * `[ ][#]<digits>` so we get the collection-level label ("DSNR").
 *
 * Falls back to a prettified slug only when the per-token name *is* the slug
 * (parser fallback when `metadata.name` is null).
 */
export function deriveCollectionGroupName(
  itemName: string,
  slug: string,
): string {
  const stripped = itemName.replace(/\s*#?\s*\d+\s*$/, '').trim();
  if (stripped.length > 0 && stripped !== itemName) {
    return stripped;
  }
  if (itemName === slug) {
    return slug
      .split('-')
      .filter((w) => w.length > 0)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return itemName;
}
