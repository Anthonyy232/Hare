import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { findManifest, forgetAllManifests, forgetManifests, recordManifest } from './manifest-store';

describe('recorded stream manifests', () => {
  beforeEach(() => fakeBrowser.reset());
  afterEach(() => vi.unstubAllGlobals());

  it('waits for pending recordings and prefers a master playlist over later variants', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.includes('master') ? '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080' : '#EXTM3U')));
    recordManifest(1, 'https://media.test/master.m3u8');
    recordManifest(1, 'https://media.test/variant.m3u8');
    expect(await findManifest(1, [])).toBe('https://media.test/master.m3u8');
    expect((await browser.storage.local.get('manifests-1'))['manifests-1']).toEqual([
      'https://media.test/master.m3u8', 'https://media.test/variant.m3u8',
    ]);
  });

  it('keeps recent distinct requests per tab and falls back when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unavailable')));
    for (let i = 0; i < 22; i++) recordManifest(1, `https://media.test/${i}.mpd`);
    recordManifest(1, 'https://media.test/21.mpd');
    recordManifest(-1, 'https://media.test/background.mpd');
    expect(await findManifest(1, [])).toBe('https://media.test/21.mpd');
    const stored = await browser.storage.local.get(null);
    expect(stored['manifests-1']).toHaveLength(20);
    expect(stored).not.toHaveProperty('manifests--1');
  });

  it('orders tab cleanup after recording and clears only manifests on browser restart', async () => {
    await browser.storage.local.set({ unrelated: 'keep' });
    recordManifest(1, 'https://media.test/one.mpd');
    forgetManifests(1);
    expect(await findManifest(1, [])).toBeNull();
    recordManifest(2, 'https://media.test/two.mpd');
    forgetAllManifests();
    expect(await findManifest(2, [])).toBeNull();
    expect(await browser.storage.local.get(null)).toEqual({ unrelated: 'keep' });
  });
});
