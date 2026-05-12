import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCollectionCache, getCollectionMetadata } from './collections';

const KEY = 'test-key';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('getCollectionMetadata', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    clearCollectionCache();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('returns the twitter handle from the OpenSea response', async () => {
    const fakeFetch = vi.fn(async () => jsonResponse({ twitter_username: 'dengsnft' }));
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const md = await getCollectionMetadata('dengs', KEY);
    expect(md.twitterUsername).toBe('dengsnft');
    expect(fakeFetch).toHaveBeenCalledOnce();
  });

  it('caches successful lookups (no second fetch)', async () => {
    const fakeFetch = vi.fn(async () => jsonResponse({ twitter_username: 'dengsnft' }));
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    await getCollectionMetadata('dengs', KEY);
    await getCollectionMetadata('dengs', KEY);
    expect(fakeFetch).toHaveBeenCalledOnce();
  });

  it('returns null handle when the field is missing or empty', async () => {
    const fakeFetch = vi.fn(async () => jsonResponse({}));
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const md = await getCollectionMetadata('no-handle', KEY);
    expect(md.twitterUsername).toBeNull();
  });

  it('strips a leading @ if OpenSea includes one', async () => {
    const fakeFetch = vi.fn(async () => jsonResponse({ twitter_username: '@dengsnft' }));
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const md = await getCollectionMetadata('dengs', KEY);
    expect(md.twitterUsername).toBe('dengsnft');
  });

  it('caches 404s as null (collection does not exist)', async () => {
    const fakeFetch = vi.fn(async () => new Response('not found', { status: 404 }));
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    await getCollectionMetadata('ghost', KEY);
    await getCollectionMetadata('ghost', KEY);
    expect(fakeFetch).toHaveBeenCalledOnce();
  });

  it('does NOT cache transient failures (so we retry next sweep)', async () => {
    let calls = 0;
    const fakeFetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('rate limit', { status: 429 });
      return jsonResponse({ twitter_username: 'eventually' });
    });
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const first = await getCollectionMetadata('flaky', KEY);
    expect(first.twitterUsername).toBeNull();
    const second = await getCollectionMetadata('flaky', KEY);
    expect(second.twitterUsername).toBe('eventually');
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it('handles network errors gracefully (returns null)', async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error('connection refused');
    });
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const md = await getCollectionMetadata('whatever', KEY);
    expect(md.twitterUsername).toBeNull();
  });

  it('sends the API key in the x-api-key header', async () => {
    const fakeFetch = vi.fn(async () => jsonResponse({ twitter_username: 'x' }));
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    await getCollectionMetadata('cool', KEY);
    const [, init] = fakeFetch.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
  });
});
