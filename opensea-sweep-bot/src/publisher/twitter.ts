import { TwitterApi } from 'twitter-api-v2';
import { normalizeForTwitter, type SupportedTwitterMime } from '../images/mime';

const MAX_MEDIA_PER_TWEET = 4;

export interface TwitterCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface TwitterClient {
  uploadMedia(buffer: Buffer, mimeType: SupportedTwitterMime): Promise<string>;
  tweet(text: string, mediaIds: string[]): Promise<string>;
}

export function makeRealTwitterClient(creds: TwitterCredentials): TwitterClient {
  const api = new TwitterApi({
    appKey: creds.apiKey,
    appSecret: creds.apiSecret,
    accessToken: creds.accessToken,
    accessSecret: creds.accessTokenSecret,
  });

  return {
    async uploadMedia(buffer, mimeType) {
      return api.v1.uploadMedia(buffer, { mimeType });
    },
    async tweet(text, mediaIds) {
      const payload =
        mediaIds.length > 0
          ? { text, media: { media_ids: mediaIds as [string] | [string, string] | [string, string, string] | [string, string, string, string] } }
          : { text };
      const res = await api.v2.tweet(payload);
      return res.data.id;
    },
  };
}

export interface PublisherOptions {
  client: TwitterClient;
  dryRun: boolean;
}

export interface PublishResult {
  tweetId: string;
  uploadedMediaCount: number;
  skippedMediaCount: number;
}

export class TwitterPublisher {
  constructor(private readonly opts: PublisherOptions) {}

  async publishSweep(
    text: string,
    imageBuffers: Buffer[],
  ): Promise<PublishResult> {
    const capped = imageBuffers.slice(0, MAX_MEDIA_PER_TWEET);

    if (this.opts.dryRun) {
      console.log(
        `[publisher] DRY_RUN tweet (${capped.length} media): ${text}`,
      );
      return {
        tweetId: 'dry-run',
        uploadedMediaCount: 0,
        skippedMediaCount: imageBuffers.length,
      };
    }

    const mediaIds: string[] = [];
    let skipped = 0;
    for (const buf of capped) {
      const normalized = await normalizeForTwitter(buf);
      if (!normalized) {
        console.warn(
          `[publisher] skipping buffer; sharp could not decode it (${buf.length} bytes)`,
        );
        skipped++;
        continue;
      }
      if (normalized.buffer !== buf) {
        console.log(
          `[publisher] re-encoded image to ${normalized.mime} (was unknown format)`,
        );
      }
      try {
        const id = await this.opts.client.uploadMedia(
          normalized.buffer,
          normalized.mime,
        );
        mediaIds.push(id);
      } catch (err) {
        console.warn('[publisher] uploadMedia failed, skipping image', err);
        skipped++;
      }
    }

    const tweetId = await this.opts.client.tweet(text, mediaIds);
    return {
      tweetId,
      uploadedMediaCount: mediaIds.length,
      skippedMediaCount: skipped + (imageBuffers.length - capped.length),
    };
  }
}
