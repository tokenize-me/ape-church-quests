import fs from 'fs';
import path from 'path';
import { OpenSeaStreamClient, type ItemSoldEvent } from '@opensea/stream-js';
import { WebSocket } from 'ws';
import { LocalStorage } from 'node-localstorage';
import { parseItemSoldEvent, type ParseResult } from './parser';

const STORAGE_DIR = path.resolve(__dirname, '..', '..', '.opensea-storage');

export interface StreamClientOptions {
  apiKey: string;
  onParsed: (result: ParseResult) => void;
  onError?: (err: unknown) => void;
}

export class StreamClient {
  private client: OpenSeaStreamClient | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly opts: StreamClientOptions) {}

  connect(): void {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
    const sessionStorage = new LocalStorage(STORAGE_DIR);

    this.client = new OpenSeaStreamClient({
      token: this.opts.apiKey,
      connectOptions: {
        transport: WebSocket as unknown as never,
        sessionStorage: sessionStorage as unknown as never,
      },
      onError: (err) => {
        console.error('[stream-client] SDK error', err);
        this.opts.onError?.(err);
      },
    });

    console.log('[stream-client] connecting & subscribing to item_sold (all collections)');
    this.unsubscribe = this.client.onItemSold('*', (raw: ItemSoldEvent) => {
      try {
        this.opts.onParsed(parseItemSoldEvent(raw));
      } catch (err) {
        console.error('[stream-client] handler threw', err);
      }
    });
  }

  disconnect(): void {
    try {
      this.unsubscribe?.();
    } finally {
      this.unsubscribe = null;
      this.client?.disconnect();
      this.client = null;
    }
  }
}
