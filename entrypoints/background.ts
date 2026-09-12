import { loadSettings, saveSettings } from '../lib/settings';
import { logger } from '../lib/logger';
import { SyncCoordinator } from '../lib/sync-coordinator';
import { SyncStartup } from '../lib/sync-startup';
import { getTabMedia, aggregateStatus } from '../lib/tab-media';
import type { SyncEventPayload, SyncCandidate } from '../lib/sync-types';
import type { HareMessage } from '../lib/types';

export default defineBackground(() => {
  const coordinator = new SyncCoordinator();
  const startup = new SyncStartup(coordinator);
  void coordinator.restoreSession();

  browser.runtime.onConnect.addListener(port => {
    if (port.name !== 'sync-keepalive') return;
    port.onMessage.addListener(() => {});
    port.onDisconnect.addListener(() => { void browser.runtime.lastError; });
  });

  browser.tabs.onRemoved.addListener(tabId => {
    void coordinator.ready.then(() => coordinator.handleTabRemoved(tabId));
  });

  browser.runtime.onMessage.addListener((message: HareMessage, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return;
    const handle = async (): Promise<unknown> => {
      await coordinator.ready;
      switch (message.type) {
        case 'GET_PAGE_CONTEXT': return { hostname: sender.tab?.url ? new URL(sender.tab.url).hostname : '' };
        case 'SYNC_PAUSE':
        case 'SYNC_PLAY':
        case 'SYNC_SEEK':
        case 'SYNC_RATE':
        case 'SYNC_BUFFERING':
          if (sender.tab?.id != null) await coordinator.handleSyncEvent(sender.tab.id, message.payload as SyncEventPayload, sender.frameId);
          return { success: true };
        case 'GET_SYNC_CANDIDATES': {
          const candidates = await Promise.all((await browser.tabs.query({})).map(async (tab): Promise<SyncCandidate | null> => {
            if (tab.id == null || !tab.url || !/^(https?|file):/.test(tab.url)) return null;
            const status = aggregateStatus((await getTabMedia(tab.id)).map(entry => entry.status));
            return status.hasVideos ? {
              tabId: tab.id, title: tab.title || 'Untitled', domain: new URL(tab.url).hostname,
              videoCount: status.videoCount,
            } : null;
          }));
          return candidates.filter(candidate => candidate !== null);
        }
        case 'START_SYNC': {
          const payload = message.payload as { tabIdA?: number; tabIdB?: number } | undefined;
          await startup.start(payload?.tabIdA!, payload?.tabIdB!);
          return { success: true };
        }
        case 'STOP_SYNC': {
          // A late stop from a removed/nonparticipating content frame must not kill a new pair.
          if (sender.tab?.id != null && !coordinator.hasEndpoint(sender.tab.id, sender.frameId)) return { success: true };
          await startup.stop();
          return { success: true };
        }
        case 'NUDGE_OFFSET':
          if (typeof message.payload !== 'number' || !Number.isFinite(message.payload)) throw new Error('Invalid offset.');
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
