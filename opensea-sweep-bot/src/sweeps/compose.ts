import {
  COLLECTION_NAME_OVERRIDES,
  IMAGE_DOWNLOAD_TIMEOUT_MS,
  TWITTER_NATIVE_GRID_MAX,
} from '../config';
import { buildTweet } from '../formatter/tweet';
import { selectImagesToShow } from '../images/selector';
import { downloadImages } from '../images/downloader';
import { buildCollage } from '../images/collage';
import { getCollectionMetadata } from '../opensea/collections';
import type { SweepDetected } from '../aggregator/types';

// Tweet text for a sweep, including the collection's @handle when OpenSea
// has one. Shared by the live stream path and the backfill script.
export async function buildSweepText(
  sweep: SweepDetected,
  openseaApiKey: string,
): Promise<string> {
  const { twitterUsername, name } = await getCollectionMetadata(
    sweep.collectionSlug,
    openseaApiKey,
  );
  if (twitterUsername) {
    console.log(`[index] collection @${twitterUsername} found for slug=${sweep.collectionSlug}`);
  }
  const collectionName = resolveCollectionName(sweep, name);
  return buildTweet({ ...sweep, collectionName }, twitterUsername).text;
}

// Longer token ids (typically ERC-1155) read as noise in a tweet, so they're
// left off the "<Collection> #<id>" label.
const MAX_TOKEN_ID_LABEL_LENGTH = 10;

// The name the tweet should use. `sweep.collectionName` is the first token's
// own name ("Frogling #42"), which is usually right. Some collections' tokens
// have no real name (MAYC → "#27084" or nothing, Sloooths → "#515"), which
// used to produce "picked up a #27084"; those get the collection's name
// instead — COLLECTION_NAME_OVERRIDES first, then OpenSea's display name,
// then a prettified slug — plus "#<tokenId>" for a single NFT.
export function resolveCollectionName(
  sweep: SweepDetected,
  collectionDisplayName: string | null,
): string {
  const itemName = sweep.collectionName.trim();
  const usable =
    itemName.length > 0 &&
    itemName !== sweep.collectionSlug &&
    !/^#?\s*\d+$/.test(itemName);
  if (usable) return sweep.collectionName;

  const label =
    COLLECTION_NAME_OVERRIDES[sweep.collectionSlug] ??
    collectionDisplayName ??
    prettifySlug(sweep.collectionSlug);
  const tokenId = sweep.nfts[0]?.tokenId;
  if (sweep.nfts.length === 1 && tokenId && tokenId.length <= MAX_TOKEN_ID_LABEL_LENGTH) {
    return `${label} #${tokenId}`;
  }
  return label;
}

function prettifySlug(slug: string): string {
  return slug
    .split('-')
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Downloads the sweep's images; more than TWITTER_NATIVE_GRID_MAX are merged
// into a single collage. Falls back to text-only if the collage fails.
export async function buildSweepMedia(sweep: SweepDetected): Promise<Buffer[]> {
  const urls = selectImagesToShow(sweep);
  const downloaded = await downloadImages(urls, IMAGE_DOWNLOAD_TIMEOUT_MS);

  if (downloaded.length <= TWITTER_NATIVE_GRID_MAX) return downloaded;
  try {
    const collage = await buildCollage(downloaded);
    console.log(`[index] built collage from ${downloaded.length} images`);
    return [collage];
  } catch (err) {
    console.error('[index] collage build failed, posting text-only', err);
    return [];
  }
}
