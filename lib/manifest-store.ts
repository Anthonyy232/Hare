import { browser } from 'wxt/browser';
import { logger } from './logger';

/** Players using MediaSource expose blob URLs; their HLS/DASH requests supply playable links. */
export const MANIFEST_URLS = ['*://*/*.m3u8*', '*://*/*.mpd*'];

const key = (tabId: number) => `manifests-${tabId}`;
let writes = Promise.resolve();

// Local storage survives updates: Firefox can keep pre-update pages running after their
// performance resource lists have filled up, leaving these records as the only source.
async function manifests(tabId: number): Promise<string[]> {
  const stored = await browser.storage.local.get(key(tabId)) as Record<string, string[] | undefined>;
  return stored[key(tabId)] ?? [];
}

function write(operation: () => Promise<void>): void {
  writes = writes.then(operation).catch(error => logger.warn('Could not update recorded stream manifests:', error));
}

export function recordManifest(tabId: number, url: string): void {
  // Requests outside tabs include findManifest's own.
  if (tabId < 0) return;
  write(async () => {
    const urls = await manifests(tabId);
    if (!urls.includes(url)) await browser.storage.local.set({ [key(tabId)]: [...urls, url].slice(-20) });
  });
}

export function forgetManifests(tabId: number): void {
  write(() => browser.storage.local.remove(key(tabId)));
}

/** Tab ids start over when the browser restarts. */
export function forgetAllManifests(): void {
  write(async () => {
    const stored = await browser.storage.local.get(null);
    await browser.storage.local.remove(Object.keys(stored).filter(name => name.startsWith('manifests-')));
  });
}

export async function findManifest(tabId: number, pageManifests: string[]): Promise<string | null> {
  await writes;
  const urls = [...new Set([...pageManifests, ...await manifests(tabId)])].slice(-20);
  const texts = await Promise.all(urls.map(async url => {
    try {
      return await (await fetch(url, { signal: AbortSignal.timeout(2500) })).text();
    } catch { return ''; }
  }));
  // HLS players request single-quality playlists after the master listing all qualities.
  return urls.findLast((_, i) => texts[i].includes('#EXT-X-STREAM-INF') || texts[i].includes('<MPD')) ?? urls.at(-1) ?? null;
}
