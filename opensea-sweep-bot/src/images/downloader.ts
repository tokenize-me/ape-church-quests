const MAX_BYTES_PER_IMAGE = 20 * 1024 * 1024;
const USER_AGENT = 'opensea-sweep-bot/0.1 (+https://github.com/)';

export async function downloadImages(
  urls: string[],
  timeoutMs: number,
): Promise<Buffer[]> {
  const results = await Promise.all(
    urls.map((url) => downloadWithRetry(url, timeoutMs)),
  );
  return results.filter((b): b is Buffer => b !== null);
}

async function downloadWithRetry(
  url: string,
  timeoutMs: number,
): Promise<Buffer | null> {
  const normalized = normalizeUrl(url);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await downloadOnce(normalized, timeoutMs);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[downloader] attempt ${attempt} failed for ${normalized}: ${reason}`,
      );
    }
  }
  return null;
}

async function downloadOnce(url: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const contentLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES_PER_IMAGE) {
      throw new Error(`response too large: ${contentLength} bytes`);
    }
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES_PER_IMAGE) {
      throw new Error(`response too large: ${arrayBuffer.byteLength} bytes`);
    }
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeUrl(url: string): string {
  if (url.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${url.slice('ipfs://'.length)}`;
  }
  return url;
}
