import sharp from 'sharp';

export type SupportedTwitterMime = 'image/jpeg' | 'image/png' | 'image/webp';

export function detectTwitterMime(buf: Buffer): SupportedTwitterMime | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export interface NormalizedMedia {
  buffer: Buffer;
  mime: SupportedTwitterMime;
}

/**
 * Returns the buffer ready for Twitter upload. Pass-through if already
 * JPEG/PNG/WebP; otherwise tries to re-encode as JPEG via sharp (handles SVG,
 * GIF static-frame, AVIF, HEIF, etc.). Returns null only if sharp can't read
 * the buffer at all.
 */
export async function normalizeForTwitter(
  buf: Buffer,
): Promise<NormalizedMedia | null> {
  const detected = detectTwitterMime(buf);
  if (detected) return { buffer: buf, mime: detected };

  try {
    const converted = await sharp(buf, { failOn: 'none' })
      .flatten({ background: { r: 28, g: 28, b: 30 } })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { buffer: converted, mime: 'image/jpeg' };
  } catch {
    return null;
  }
}
