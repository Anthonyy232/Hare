import { loadSettings, saveSettings } from '../lib/settings';
import { logger } from '../lib/logger';
import { SyncCoordinator } from '../lib/sync-coordinator';
import { SyncStartup } from '../lib/sync-startup';
import { getTabMedia } from '../lib/messaging';
import { mpv, MPV_TAB_ID } from '../lib/mpv';
import { MANIFEST_URLS, forgetAllManifests, forgetManifests, recordManifest } from '../lib/stream';
import type { SyncCandidate } from '../lib/sync-types';
import type { HareMessage, Replies } from '../lib/types';

export default defineBackground(() => {
  const coordinator = new SyncCoordinator();
  const startup = new SyncStartup(coordinator);
  void coordinator.restoreSession();
  mpv.onEvent = event => { void coordinator.handleSyncEvent(MPV_TAB_ID, event); };
  mpv.onFileChanged = () => { void coordinator.stopSync('mpv opened another file'); };

  browser.runtime.onConnect.addListener(port => {
    if (port.name !== 'sync-keepalive') return;
    port.onMessage.addListener(() => {});
    port.onDisconnect.addListener(() => { void browser.runtime.lastError; });
  });

  browser.tabs.onRemoved.addListener(tabId => {
    forgetManifests(tabId);
    void coordinator.ready.then(() => coordinator.handleTabRemoved(tabId));
  });

  browser.webRequest.onCompleted.addListener(({ tabId, url }) => recordManifest(tabId, url), { urls: MANIFEST_URLS });
  browser.webNavigation.onCommitted.addListener(({ tabId, frameId }) => { if (frameId === 0) forgetManifests(tabId); });
  browser.runtime.onStartup.addListener(forgetAllManifests);

  browser.runtime.onMessage.addListener((message: HareMessage, sender, sendResponse) => {
    const handle = async (): Promise<Replies[keyof Replies]> => {
      await coordinator.ready;
      switch (message.type) {
        case 'GET_PAGE_CONTEXT': return { hostname: sender.tab?.url ? new URL(sender.tab.url).hostname : '' };
        case 'SYNC_EVENT':
          if (sender.tab?.id != null) await coordinator.handleSyncEvent(sender.tab.id, message.payload, sender.frameId);
          return { success: true };
        case 'GET_SYNC_CANDIDATES': {
          const tabs = (await browser.tabs.query({})).map(async (tab): Promise<SyncCandidate | null> => {
            if (tab.id == null || !tab.url || !/^(https?|file):/.test(tab.url)) return null;
            const videoCount = (await getTabMedia(tab.id)).reduce((count, frame) => count + frame.speeds.length, 0);
            return videoCount ? { tabId: tab.id, title: tab.title || 'Untitled', domain: new URL(tab.url).hostname, favIconUrl: tab.favIconUrl, videoCount } : null;
          });
          const candidates = await Promise.all([...tabs, mpv.candidate()]);
          return candidates.filter(candidate => candidate !== null);
        }
        case 'START_SYNC': {
          await startup.start(message.payload.tabIdA, message.payload.tabIdB);
          return { success: true };
        }
        case 'STOP_SYNC': {
          // A late stop from a removed/nonparticipating content frame must not kill a new pair.
          const fromExtensionPage = sender.url?.startsWith(browser.runtime.getURL('/')) === true;
          if (!fromExtensionPage && sender.tab?.id != null && !coordinator.hasEndpoint(sender.tab.id, sender.frameId)) return { success: true };
          await startup.stop();
          return { success: true };
        }
        case 'SET_NUDGE_STEP':
          await coordinator.setNudgeStep(message.payload);
          return { success: true };
        case 'NUDGE_OFFSET':
          if (!coordinator.getStatus().active) throw new Error('The sync session has ended.');
          coordinator.nudgeOffset(message.payload);
          return { success: true };
        case 'GET_SYNC_STATUS': return coordinator.getStatus();
        default: return { success: false, error: 'Unknown message type' };
      }
    };
    void handle().then(sendResponse, error => {
      logger.warn('Extension request failed:', error);
      sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  });

  browser.runtime.onInstalled.addListener(async details => {
    try {
      const settings = await loadSettings({ strict: true });
      // Preserve settings already synced from another installation.
      if (details.reason === 'install') await saveSettings(settings);
    } catch (error) { logger.error('Could not initialize settings; existing storage was preserved:', error); }
  });
});
