import { browser } from 'wxt/browser';

/** HLS and DASH manifests. Players that use MediaSource only expose a blob: URL. */
export const MANIFEST_URLS = ['*://*/*.m3u8*', '*://*/*.mpd*'];

const key = (tabId: number) => `manifests-${tabId}`;
let writes = Promise.resolve();

async function manifests(tabId: number): Promise<string[]> {
  const stored = await browser.storage.session.get(key(tabId)) as Record<string, string[] | undefined>;
  return stored[key(tabId)] ?? [];
}

/** Remembers a tab's manifests, including ones a player's worker loads, which its page never sees. */
export function recordManifest(tabId: number, url: string): void {
  // Requests outside tabs include findManifest's own.
  if (tabId < 0) return;
  // Serialized, so concurrent responses don't overwrite each other's additions.
  writes = writes.then(async () => {
    const urls = await manifests(tabId);
    if (!urls.includes(url)) await browser.storage.session.set({ [key(tabId)]: [...urls, url].slice(-20) });
  }).catch(() => {});
}

export function forgetManifests(tabId: number): void {
  writes = writes.then(() => browser.storage.session.remove(key(tabId))).catch(() => {});
}

/** The newest manifest that lists every quality. HLS players load single-quality playlists after their master. */
export async function findManifest(tabId: number, pageManifests: string[]): Promise<string | undefined> {
  const urls = [...new Set([...pageManifests, ...await manifests(tabId)])].slice(-20);
  const texts = await Promise.all(urls.map(url => fetch(url).then(response => response.text(), () => '')));
  return urls.findLast((_, i) => texts[i].includes('#EXT-X-STREAM-INF') || texts[i].includes('<MPD')) ?? urls.at(-1);
}

/**
 * A one-item playlist, so the OS opens the link with its default media player. VLC reads the options;
 * hare.lua applies them in mpv. Some hosts, such as Patreon's, only serve requests from their site.
 */
export function playlist(url: string, title: string, time: number, page: string): string {
  const start = time > 0 ? `#EXTVLCOPT:start-time=${time}\n` : '';
  return `#EXTM3U\n#EXTINF:-1,${title.replace(/\s+/g, ' ')}\n#EXTVLCOPT:http-referrer=${new URL(page).origin}/\n${start}${url}\n`;
}
