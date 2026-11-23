import { findManifest, watchManifests } from '../lib/export/manifest-store';
import { logger } from '../lib/logger';
import type { HareMessage, Replies } from '../lib/messages';
import { failureReply } from '../lib/messaging';
import { loadSettings, saveSettings } from '../lib/settings/settings';
import { startSyncService } from '../lib/sync/service';

export default defineBackground(() => {
  const sync = startSyncService();
  watchManifests();

  browser.runtime.onMessage.addListener((message: HareMessage, sender, sendResponse) => {
    const handle = async (): Promise<Replies[keyof Replies]> => {
      switch (message.type) {
        case 'GET_PAGE_CONTEXT':
          return { hostname: sender.tab?.url ? new URL(sender.tab.url).hostname : '' };
        case 'FIND_MANIFEST':
          return { url: await findManifest(message.payload.tabId, message.payload.manifests) };
        default: {
          const reply = await sync.handle(message, sender);
          return reply === undefined ? { success: false, error: 'Unknown message type' } : reply;
        }
      }
    };
    void handle().then(sendResponse, error => {
      logger.warn('Extension request failed:', error);
      sendResponse(failureReply(error));
    });
    return true;
  });

  browser.runtime.onInstalled.addListener(async details => {
    if (details.reason !== 'install') return;
    try {
      // Preserve settings already synced from another installation.
      await saveSettings(await loadSettings());
    } catch (error) {
      logger.error('Could not initialize settings; existing storage was preserved:', error);
    }
  });
});
