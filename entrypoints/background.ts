import { loadSettings, saveSettings } from '../lib/settings';
import { logger } from '../lib/logger';
import { SyncCoordinator } from '../lib/sync-coordinator';
import type { SyncEventPayload, SyncCandidate } from '../lib/sync-types';

export default defineBackground(() => {
  /**
   * Initializes or validates settings on installation/update to ensure
   * the sync storage contains a valid schema version.
   */
  const syncCoordinator = new SyncCoordinator();

  // If the SW was just respawned mid-session, rehydrate from chrome.storage.session
  // so that the in-memory `session` is restored and drift correction resumes.
  // Fire-and-forget: messages received before this completes will silently no-op
  // and the next event will land on a restored session.
  void syncCoordinator.restoreSession();

  // Keep-alive ports from content scripts prevent MV3 service worker termination
  // while sync is active. The port reset Chrome's idle timer; content scripts also
  // reconnect periodically to bypass Chrome's hard cap on a single port instance.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'sync-keepalive') {
      logger.warn('Sync keep-alive port connected', { tab: port.sender?.tab?.id });
      // Each ping resets the SW idle timer. Drain silently — we just want the
      // event to land in the SW so its lifetime is extended.
      port.onMessage.addListener(() => {
        // no-op
      });
      port.onDisconnect.addListener(() => {
        logger.warn('Sync keep-alive port disconnected', {
          tab: port.sender?.tab?.id,
          error: browser.runtime.lastError?.message,
        });
      });
    }
  });

  // Stop sync when a synced tab closes
  browser.tabs.onRemoved.addListener((tabId) => {
    syncCoordinator.handleTabRemoved(tabId);
  });

  // Handle sync messages from content scripts and popup
  browser.runtime.onMessage.addListener(
    (message: { type: string; payload?: unknown }, sender, sendResponse) => {
      switch (message.type) {
        case 'SYNC_PAUSE':
        case 'SYNC_PLAY':
        case 'SYNC_SEEK':
        case 'SYNC_BUFFERING': {
          // User-initiated events forwarded from content script SyncAgent
          const tabId = sender.tab?.id;
          if (tabId == null) return;
          const event = message.payload as SyncEventPayload;
          syncCoordinator.handleSyncEvent(tabId, event);
          return;
        }

        case 'GET_SYNC_CANDIDATES': {
          (async () => {
            try {
              const tabs = await browser.tabs.query({});
              const candidates: SyncCandidate[] = [];

              for (const tab of tabs) {
                if (!tab.id || !tab.url) continue;
                try {
                  // Query all frames — videos are often in iframes (e.g., YouTube)
                  const frames = await browser.webNavigation.getAllFrames({ tabId: tab.id });
                  if (!frames || frames.length === 0) continue;

                  let totalVideoCount = 0;
                  let hasAnyVideos = false;

                  const responses = await Promise.all(
                    frames.map(async (frame) => {
                      try {
                        return await browser.tabs.sendMessage(
                          tab.id!,
                          { type: 'GET_STATUS' },
                          { frameId: frame.frameId }
                        );
                      } catch {
                        return null;
                      }
                    })
                  );

                  for (const response of responses) {
                    if (response && (response as { videoCount: number }).videoCount > 0) {
                      totalVideoCount += (response as { videoCount: number }).videoCount;
                      hasAnyVideos = true;
                    }
                  }

                  if (hasAnyVideos) {
                    const url = new URL(tab.url);
                    candidates.push({
                      tabId: tab.id,
                      title: tab.title || 'Untitled',
                      domain: url.hostname,
                      videoCount: totalVideoCount,
                      favIconUrl: tab.favIconUrl,
                    });
                  }
                } catch {
                  // Tab has no content script or frames inaccessible — skip
                }
              }

              sendResponse(candidates);
            } catch {
              sendResponse([]);
            }
          })();
          return true; // async response
        }

        case 'START_SYNC': {
          const { tabIdA, tabIdB } = message.payload as { tabIdA: number; tabIdB: number };
          (async () => {
            try {
              // Activate sync on whichever frame has the video in each tab
              const activateInTab = async (tabId: number) => {
                const frames = await browser.webNavigation.getAllFrames({ tabId });
                if (!frames) throw new Error(`No frames in tab ${tabId}`);

                for (const frame of frames) {
                  try {
                    const response = await browser.tabs.sendMessage(
                      tabId,
                      { type: 'SYNC_ACTIVATE' },
                      { frameId: frame.frameId }
                    );
                    if (response && (response as { success: boolean }).success) {
                      return {
                        currentTime: (response as { currentTime: number }).currentTime ?? 0,
                        frameId: frame.frameId,
                      };
                    }
                  } catch {
                    // Frame doesn't have content script or no video — try next
                  }
                }
                throw new Error(`No video found in tab ${tabId}`);
              };

              const [resultA, resultB] = await Promise.all([
                activateInTab(tabIdA),
                activateInTab(tabIdB),
              ]);

              // Store tab metadata for display
              const tabs = await browser.tabs.query({});
              for (const tab of tabs) {
                if (tab.id && tab.url) {
                  try {
                    const url = new URL(tab.url);
                    syncCoordinator.setTabMeta(tab.id, tab.title || 'Untitled', url.hostname);
                  } catch {
                    // Invalid URL — skip
                  }
                }
              }

              syncCoordinator.startSync(
                { tabId: tabIdA, frameId: resultA.frameId },
                { tabId: tabIdB, frameId: resultB.frameId },
                { currentTimeA: resultA.currentTime, currentTimeB: resultB.currentTime }
              );

              sendResponse({ success: true });
            } catch (error) {
              sendResponse({ success: false, error: String(error) });
            }
          })();
          return true;
        }

        case 'STOP_SYNC': {
          syncCoordinator.stopSync('user clicked stop');
          sendResponse({ success: true });
          return;
        }

        case 'NUDGE_OFFSET': {
          const delta = message.payload as number;
          syncCoordinator.nudgeOffset(delta);
          sendResponse({ success: true });
          return;
        }

        case 'GET_SYNC_STATUS': {
          sendResponse(syncCoordinator.getStatus());
          return;
        }
      }
    }
  );

  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install' || details.reason === 'update') {
      try {
        const settings = await loadSettings();
        await saveSettings(settings);
      } catch (error) {
        // Critical: Settings initialization failed - attempt recovery
        logger.error('Settings initialization failed:', error);
        try {
          const { DEFAULT_SETTINGS } = await import('../lib/types');
          await saveSettings(DEFAULT_SETTINGS);
          logger.warn('Settings recovered using defaults');
        } catch (recoveryError) {
          // Complete failure - log and continue (extension will use in-memory defaults)
          logger.error('Settings recovery failed:', recoveryError);
          logger.error('Extension will function with reduced capability until settings are manually reset');
        }
      }
    }
  });
});
