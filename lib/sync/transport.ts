import { browser, type Browser } from 'wxt/browser';
import { isHarePage } from '../hostname';
import { getFrameIds, getTabMedia, sendToTab, withTimeout } from '../messaging';
import type { HareMessage, Reply } from '../messages';
import type { MpvClient } from './mpv';
import { MPV_TAB_ID, type SyncCandidate } from './types';

/** How sync reaches a player, whether it plays in a tab or in mpv. */
export interface SyncTransport {
  send<M extends HareMessage>(tabId: number, message: M, frameId?: number): Promise<Reply<M>>;
  frames(tabId: number): Promise<number[]>;
  title(tabId: number): Promise<string>;
}

const tabTitle = (tab: Browser.tabs.Tab) => tab.title || 'Untitled';

export function createTransport(mpv: MpvClient): SyncTransport {
  return {
    send: (tabId, message, frameId) => tabId === MPV_TAB_ID
      ? withTimeout(mpv.handle(message) as Promise<Reply<typeof message>>)
      : sendToTab(tabId, message, frameId),
    frames: tabId => tabId === MPV_TAB_ID ? Promise.resolve([0]) : getFrameIds(tabId),
    title: async tabId => tabId === MPV_TAB_ID ? mpv.title : tabTitle(await browser.tabs.get(tabId)),
  };
}

export async function syncCandidates(mpv: MpvClient): Promise<SyncCandidate[]> {
  const tabs = (await browser.tabs.query({})).map(async (tab): Promise<SyncCandidate | null> => {
    if (tab.id == null || !tab.url || !isHarePage(tab.url)) return null;
    const videoCount = (await getTabMedia(tab.id)).reduce((count, frame) => count + frame.speeds.length, 0);
    return videoCount ? { tabId: tab.id, title: tabTitle(tab), domain: new URL(tab.url).hostname, favIconUrl: tab.favIconUrl, videoCount } : null;
  });
  return (await Promise.all([...tabs, mpv.candidate()])).filter(candidate => candidate !== null);
}
