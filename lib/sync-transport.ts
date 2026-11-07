import { browser } from 'wxt/browser';
import { getFrameIds, getTabMedia, sendToTab } from './messaging';
import { mpv } from './mpv';
import { MPV_TAB_ID } from './sync-types';
import type { SyncCandidate } from './sync-types';
import type { HareMessage, Reply } from './messages';

export function sendToEndpoint<M extends HareMessage>(...args: Parameters<typeof sendToTab<M>>): Promise<Reply<M>> {
  const [tabId, message] = args;
  return tabId === MPV_TAB_ID ? mpv.handle(message) as Promise<Reply<M>> : sendToTab(...args);
}

export function endpointFrames(tabId: number): Promise<number[]> {
  return tabId === MPV_TAB_ID ? Promise.resolve([0]) : getFrameIds(tabId);
}

export async function describeEndpoint(tabId: number): Promise<{ title: string; domain: string }> {
  if (tabId === MPV_TAB_ID) return { title: mpv.title, domain: 'mpv' };
  const tab = await browser.tabs.get(tabId);
  return { title: tab.title || 'Untitled', domain: tab.url ? new URL(tab.url).hostname : '' };
}

export async function syncCandidates(): Promise<SyncCandidate[]> {
  const tabs = (await browser.tabs.query({})).map(async (tab): Promise<SyncCandidate | null> => {
    if (tab.id == null || !tab.url || !/^(https?|file):/.test(tab.url)) return null;
    const videoCount = (await getTabMedia(tab.id)).reduce((count, frame) => count + frame.speeds.length, 0);
    return videoCount ? { tabId: tab.id, title: tab.title || 'Untitled', domain: new URL(tab.url).hostname, favIconUrl: tab.favIconUrl, videoCount } : null;
  });
  return (await Promise.all([...tabs, mpv.candidate()])).filter(candidate => candidate !== null);
}
