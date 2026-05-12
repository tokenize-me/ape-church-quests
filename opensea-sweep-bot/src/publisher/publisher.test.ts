import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterPublisher, type TwitterClient } from './twitter';

// Magic-byte heads for each format so detectTwitterMime succeeds
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const UNKNOWN = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0, 0, 0, 0, 0, 0, 0, 0]);

function mockClient(): TwitterClient & {
  uploadMedia: ReturnType<typeof vi.fn>;
  tweet: ReturnType<typeof vi.fn>;
} {
  return {
    uploadMedia: vi.fn(async (_buf: Buffer, _mime: string) => `media-${Math.random().toString(36).slice(2, 8)}`),
    tweet: vi.fn(async (_text: string, _ids: string[]) => 'tweet-id-42'),
  };
}

describe('TwitterPublisher.publishSweep', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('posts a text-only tweet when no images are given', async () => {
    const client = mockClient();
    const pub = new TwitterPublisher({ client, dryRun: false });
    const result = await pub.publishSweep('hello', []);
    expect(client.uploadMedia).not.toHaveBeenCalled();
    expect(client.tweet).toHaveBeenCalledWith('hello', []);
    expect(result.tweetId).toBe('tweet-id-42');
    expect(result.uploadedMediaCount).toBe(0);
  });

  it('uploads each image and attaches all media IDs', async () => {
    const client = mockClient();
    const pub = new TwitterPublisher({ client, dryRun: false });
    const result = await pub.publishSweep('multi', [JPEG_HEAD, PNG_HEAD]);
    expect(client.uploadMedia).toHaveBeenCalledTimes(2);
    expect(client.uploadMedia).toHaveBeenNthCalledWith(1, JPEG_HEAD, 'image/jpeg');
    expect(client.uploadMedia).toHaveBeenNthCalledWith(2, PNG_HEAD, 'image/png');
    const [, ids] = client.tweet.mock.calls[0]!;
    expect((ids as string[]).length).toBe(2);
    expect(result.uploadedMediaCount).toBe(2);
  });

  it('caps media at 4 even when more buffers are given', async () => {
    const client = mockClient();
    const pub = new TwitterPublisher({ client, dryRun: false });
    const result = await pub.publishSweep('lots', [JPEG_HEAD, JPEG_HEAD, JPEG_HEAD, JPEG_HEAD, JPEG_HEAD, JPEG_HEAD]);
    expect(client.uploadMedia).toHaveBeenCalledTimes(4);
    expect(result.uploadedMediaCount).toBe(4);
    expect(result.skippedMediaCount).toBe(2);
  });

  it('skips buffers that sharp cannot decode either', async () => {
    const client = mockClient();
    const pub = new TwitterPublisher({ client, dryRun: false });
    const result = await pub.publishSweep('mixed', [JPEG_HEAD, UNKNOWN, PNG_HEAD]);
    expect(client.uploadMedia).toHaveBeenCalledTimes(2);
    expect(result.uploadedMediaCount).toBe(2);
    expect(result.skippedMediaCount).toBe(1);
  });

  it('converts SVG via sharp and uploads as JPEG', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>',
    );
    const client = mockClient();
    const pub = new TwitterPublisher({ client, dryRun: false });
    const result = await pub.publishSweep('svg-bearing', [svg]);
    expect(result.uploadedMediaCount).toBe(1);
    expect(client.uploadMedia).toHaveBeenCalledOnce();
    const [uploadedBuf, mime] = client.uploadMedia.mock.calls[0]!;
    expect(mime).toBe('image/jpeg');
    expect((uploadedBuf as Buffer).slice(0, 3).toString('hex')).toBe('ffd8ff');
  });

  it('skips a media upload that throws but still posts the tweet with the rest', async () => {
    const client = mockClient();
    let calls = 0;
    client.uploadMedia.mockImplementation(async () => {
      calls++;
      if (calls === 2) throw new Error('twitter is sad');
      return `id-${calls}`;
    });
    const pub = new TwitterPublisher({ client, dryRun: false });
    const result = await pub.publishSweep('try', [JPEG_HEAD, JPEG_HEAD, JPEG_HEAD]);
    expect(result.uploadedMediaCount).toBe(2);
    expect(result.skippedMediaCount).toBe(1);
    expect(client.tweet).toHaveBeenCalledOnce();
  });

  it('falls back to text-only when ALL media uploads fail', async () => {
    const client = mockClient();
    client.uploadMedia.mockRejectedValue(new Error('all fail'));
    const pub = new TwitterPublisher({ client, dryRun: false });
    const result = await pub.publishSweep('lonely', [JPEG_HEAD, PNG_HEAD]);
    expect(result.uploadedMediaCount).toBe(0);
    expect(client.tweet).toHaveBeenCalledWith('lonely', []);
  });

  it('lets the v2.tweet error propagate (no retry)', async () => {
    const client = mockClient();
    client.tweet.mockRejectedValue(new Error('rate limited'));
    const pub = new TwitterPublisher({ client, dryRun: false });
    await expect(pub.publishSweep('boom', [])).rejects.toThrow('rate limited');
  });

  it('dry-run mode never touches the client', async () => {
    const client = mockClient();
    const pub = new TwitterPublisher({ client, dryRun: true });
    const result = await pub.publishSweep('dry', [JPEG_HEAD, JPEG_HEAD]);
    expect(client.uploadMedia).not.toHaveBeenCalled();
    expect(client.tweet).not.toHaveBeenCalled();
    expect(result.tweetId).toBe('dry-run');
  });
});
