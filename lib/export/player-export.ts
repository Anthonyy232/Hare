import { browser } from 'wxt/browser';
import { askEveryFrame, sendToBackground } from '../messaging';

/** VLC reads these options; hare.lua applies them in mpv. Some hosts require the site referrer. */
function playlist(url: string, title: string, time: number, page: string): string {
  const start = time > 0 ? `#EXTVLCOPT:start-time=${time}\n` : '';
  return `#EXTM3U\n#EXTINF:-1,${title.replace(/\s+/g, ' ')}\n#EXTVLCOPT:http-referrer=${new URL(page).origin}/\n${start}${url}\n`;
}

async function waitForDownload(id: number): Promise<void> {
  let changed!: (delta: { id: number; state?: { current?: string } }) => void;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const check = (state: string | undefined) => {
        if (state === 'complete') resolve();
        else if (state !== 'in_progress') reject(new Error('Could not save the playlist.'));
      };
      changed = delta => {
        if (delta.id === id && delta.state) check(delta.state.current);
      };
      browser.downloads.onChanged.addListener(changed);
      timeout = setTimeout(() => reject(new Error('Saving the playlist took too long. Try again.')), 30_000);
      // Completion can occur before the listener is installed.
      void browser.downloads.search({ id }).then(items => check(items[0]?.state), reject);
    });
  } finally {
    browser.downloads.onChanged.removeListener(changed);
    clearTimeout(timeout);
  }
}

export async function exportToPlayer(tabId: number): Promise<'opened' | 'saved'> {
  const media = (await askEveryFrame(tabId, { type: 'GET_STREAM' })).find(({ reply }) => reply)?.reply;
  if (!media) throw new Error('This tab has no video that can play outside the browser.');
  // Desktop players cannot decrypt protected streams; site resolvers can still use the page URL.
  const manifest =
    !media.src && !media.encrypted
      ? (await sendToBackground({ type: 'FIND_MANIFEST', payload: { tabId, manifests: media.manifests } })).url
      : null;
  const url = media.src ?? manifest ?? media.page;
  const { title = '' } = await browser.tabs.get(tabId);
  const file = URL.createObjectURL(
    new Blob([playlist(url, title, media.time, media.page)], { type: 'audio/x-mpegurl' }),
  );
  try {
    // hare.lua recognizes playlists by this name to apply their options in mpv.
    const id = await browser.downloads.download({
      url: file,
      filename: 'hare.m3u',
      conflictAction: 'overwrite',
      saveAs: false,
    });
    await waitForDownload(id);
    try {
      await browser.downloads.open(id);
      return 'opened';
    } catch {
      // Firefox requires the original user gesture to open a download; the saved file is usable.
      return 'saved';
    }
  } finally {
    URL.revokeObjectURL(file);
  }
}
