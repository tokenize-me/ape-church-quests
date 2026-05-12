export interface CollectionMetadata {
  twitterUsername: string | null;
}

const COLLECTION_LOOKUP_TIMEOUT_MS = 5_000;
const cache = new Map<string, CollectionMetadata>();

export async function getCollectionMetadata(
  slug: string,
  apiKey: string,
): Promise<CollectionMetadata> {
  const cached = cache.get(slug);
  if (cached) return cached;

  const url = `https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}`;
  try {
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(COLLECTION_LOOKUP_TIMEOUT_MS),
    });

    if (response.ok) {
      const data = (await response.json()) as { twitter_username?: string | null };
      const result: CollectionMetadata = {
        twitterUsername: normalizeHandle(data.twitter_username),
      };
      cache.set(slug, result);
      return result;
    }

    if (response.status === 404) {
      // Collection doesn't exist on OpenSea's REST side; cache the negative
      const negative: CollectionMetadata = { twitterUsername: null };
      cache.set(slug, negative);
      return negative;
    }

    // 401/429/5xx etc. — transient, don't cache
    console.warn(
      `[opensea] collection lookup HTTP ${response.status} for slug=${slug}`,
    );
    return { twitterUsername: null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[opensea] collection lookup error for ${slug}: ${reason}`);
    return { twitterUsername: null };
  }
}

export function clearCollectionCache(): void {
  cache.clear();
}

function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^@/, '');
  return trimmed.length > 0 ? trimmed : null;
}
