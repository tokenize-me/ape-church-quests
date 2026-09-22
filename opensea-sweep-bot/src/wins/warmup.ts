import { WINS_PNL_WARMUP_TIMEOUT_MS } from '../config';
import { derivePnlImageUrl } from './formatter';
import type { WinEvent } from './types';

// Warm the PnL card the replay URL unfurls with, so X's crawler (which
// fetches og:image within seconds of the tweet) hits an already-persisted
// PNG instead of a cold render. Best-effort — never blocks the tweet.
export async function warmPnlCard(win: WinEvent): Promise<void> {
  const url = derivePnlImageUrl(win);
  if (!url) return;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(WINS_PNL_WARMUP_TIMEOUT_MS),
    });
    console.log(
      `[wins] pnl card warmup ${res.ok ? 'ok' : `status=${res.status}`} url=${url}`,
    );
  } catch (err) {
    console.warn(`[wins] pnl card warmup failed (tweet proceeds) url=${url}`, err);
  }
}
