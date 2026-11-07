import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { exportToPlayer } from './player-export';

const media = { src: 'https://media.test/video.mp4', page: 'https://site.test/watch', encrypted: false, time: 12, manifests: [] };

describe('export to desktop player', () => {
  beforeEach(() => {
    vi.spyOn(browser.webNavigation, 'getAllFrames').mockResolvedValue([{ frameId: 0 }] as never);
    vi.spyOn(browser.tabs, 'sendMessage').mockImplementation(vi.fn().mockResolvedValue(media));
    vi.spyOn(browser.tabs, 'get').mockResolvedValue({ title: 'My\nMovie' } as never);
    vi.spyOn(browser.downloads, 'download').mockImplementation(vi.fn().mockResolvedValue(7));
    vi.spyOn(browser.downloads, 'search').mockResolvedValue([{ id: 7, state: 'complete' }] as never);
    vi.spyOn(browser.downloads, 'open').mockResolvedValue(undefined);
    vi.spyOn(browser.downloads.onChanged, 'addListener').mockImplementation(() => {});
    vi.spyOn(browser.downloads.onChanged, 'removeListener').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:playlist');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('writes a playable playlist and opens a download that already completed', async () => {
    expect(await exportToPlayer(1)).toBe('opened');
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe('#EXTM3U\n#EXTINF:-1,My Movie\n#EXTVLCOPT:http-referrer=https://site.test/\n#EXTVLCOPT:start-time=12\nhttps://media.test/video.mp4\n');
    expect(browser.downloads.open).toHaveBeenCalledWith(7);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:playlist');
  });

  it('waits for its download completion event and removes the listener', async () => {
    vi.mocked(browser.downloads.search).mockResolvedValue([{ id: 7, state: 'in_progress' }] as never);
    const add = vi.spyOn(browser.downloads.onChanged, 'addListener');
    const remove = vi.spyOn(browser.downloads.onChanged, 'removeListener');
    const result = exportToPlayer(1);
    await vi.waitFor(() => expect(add).toHaveBeenCalledOnce());
    const listener = add.mock.calls[0][0];
    listener({ id: 99, state: { current: 'complete' } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(browser.downloads.open).not.toHaveBeenCalled();
    listener({ id: 7, state: { current: 'complete' } });
    expect(await result).toBe('opened');
    expect(remove).toHaveBeenCalledWith(listener);
  });

  it.each([
    ['a recorded manifest when the page plays from a blob', false, 'https://media.test/master.m3u8'],
    ['the page itself for protected media', true, 'https://site.test/watch'],
  ])('opens %s', async (_, encrypted, url) => {
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ ...media, src: null, encrypted } as never);
    const findManifest = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ url: 'https://media.test/master.m3u8' } as never);
    await exportToPlayer(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect((await blob.text()).trimEnd().split('\n').at(-1)).toBe(url);
    expect(findManifest).toHaveBeenCalledTimes(encrypted ? 0 : 1);
  });

  it('explains when no frame has a video it can hand over', async () => {
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue(null as never);
    await expect(exportToPlayer(1)).rejects.toThrow('no video');
    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  it('preserves the saved-file fallback when the browser cannot open the playlist', async () => {
    vi.mocked(browser.downloads.open).mockRejectedValue(new Error('requires user gesture'));
    expect(await exportToPlayer(1)).toBe('saved');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:playlist');
  });

  it('releases the blob if creating the download fails', async () => {
    vi.mocked(browser.downloads.download).mockRejectedValue(new Error('disk full'));
    await expect(exportToPlayer(1)).rejects.toThrow('disk full');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:playlist');
  });

  it('does not open interrupted downloads and releases their resources', async () => {
    vi.mocked(browser.downloads.search).mockResolvedValue([{ id: 7, state: 'interrupted' }] as never);
    await expect(exportToPlayer(1)).rejects.toThrow('Could not save');
    expect(browser.downloads.open).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:playlist');
  });

  it('bounds stalled downloads and releases the listener and blob', async () => {
    vi.useFakeTimers();
    vi.mocked(browser.downloads.search).mockResolvedValue([{ id: 7, state: 'in_progress' }] as never);
    const remove = vi.spyOn(browser.downloads.onChanged, 'removeListener');
    const result = expect(exportToPlayer(1)).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(remove).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:playlist');
  });
});
