import { loadSettings, saveSettings } from '../lib/settings';
import { logger } from '../lib/logger';
import { SyncCoordinator } from '../lib/sync-coordinator';
import type { SyncEventPayload, SyncCandidate, SyncCommandPayload } from '../lib/sync-types';
import type { HareMessage } from '../lib/types';

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
    (message: HareMessage, sender, sendResponse) => {
      switch (message.type) {
        case 'SYNC_PAUSE':
        case 'SYNC_PLAY':
        case 'SYNC_SEEK':
        case 'SYNC_RATE':
        case 'SYNC_BUFFERING': {
          const tabId = sender.tab?.id;
          if (tabId == null) return;
          syncCoordinator.handleSyncEvent(tabId, message.payload as SyncEventPayload, sender.frameId);
          return;
        }

        case 'GET_SYNC_CANDIDATES': {
          (async () => {
            try {
              const tabs = await browser.tabs.query({});
              const results = await Promise.all(
                tabs.map(async (tab): Promise<SyncCandidate | null> => {
                  if (!tab.id || !tab.url) return null;
                  try {
                    // Videos are often in iframes (e.g., YouTube) — query all frames.
                    const frames = await browser.webNavigation.getAllFrames({ tabId: tab.id });
                    if (!frames?.length) return null;

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

                    const totalVideoCount = responses.reduce(
                      (sum, r) => sum + ((r as { videoCount?: number } | null)?.videoCount ?? 0),
                      0
                    );
                    if (totalVideoCount === 0) return null;

                    return {
                      tabId: tab.id,
                      title: tab.title || 'Untitled',
                      domain: new URL(tab.url).hostname,
                      videoCount: totalVideoCount,
                    };
                  } catch {
                    return null;
                  }
                })
              );
              sendResponse(results.filter((c): c is SyncCandidate => c !== null));
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
                      const r = response as {
                        currentTime: number;
                        playbackRate?: number;
                        paused?: boolean;
                        timestamp?: number;
                      };
                      return {
                        currentTime: r.currentTime ?? 0,
                        playbackRate: r.playbackRate ?? 1.0,
                        paused: r.paused ?? true,
                        timestamp: r.timestamp ?? Date.now(),
                        frameId: frame.frameId,
                      };
                    }
                  } catch {
                    // Frame doesn't have content script or no video — try next
                  }
                }
                throw new Error(`No video found in tab ${tabId}`);
              };

              const [resultA, resultB, tabA, tabB] = await Promise.all([
                activateInTab(tabIdA),
                activateInTab(tabIdB),
                browser.tabs.get(tabIdA),
                browser.tabs.get(tabIdB),
              ]);

              for (const tab of [tabA, tabB]) {
                if (!tab.id || !tab.url) continue;
                try {
                  syncCoordinator.setTabMeta(tab.id, tab.title || 'Untitled', new URL(tab.url).hostname);
                } catch {
                  // Invalid URL — skip
                }
              }

              // Match B's rate to A's so they begin in sync. Direct send rather
              // than via coordinator since the session isn't started yet.
              if (Math.abs(resultA.playbackRate - resultB.playbackRate) > 1e-3) {
                try {
                  await browser.tabs.sendMessage(
                    tabIdB,
                    {
                      type: 'SYNC_RATE',
                      payload: {
                        action: 'ratechange',
                        position: 0,
                        timestamp: Date.now(),
                        generation: 0,
                        rate: resultA.playbackRate,
                      } satisfies SyncCommandPayload,
                    },
                    { frameId: resultB.frameId }
                  );
                } catch {
                  // Non-fatal — drift correction will catch up.
                }
              }

              syncCoordinator.startSync(
                { tabId: tabIdA, frameId: resultA.frameId },
                { tabId: tabIdB, frameId: resultB.frameId },
                {
                  currentTimeA: resultA.currentTime,
                  currentTimeB: resultB.currentTime,
                  timestampA: resultA.timestamp,
                  timestampB: resultB.timestamp,
                  rateA: resultA.playbackRate,
                  rateB: resultB.playbackRate,
                  pausedA: resultA.paused,
                  pausedB: resultB.paused,
                }
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

        default: {
          // Unknown message type — respond so the caller doesn't hang. The
          // content script handles the per-tab message types (GET_STATUS,
          // SET_SPEED, SYNC_*, etc.); the background script only receives a
          // subset, and runtime.onMessage in the SW also fires for those
          // tab-targeted ones with `sender.tab` set, which we ignore here.
          return;
        }
      }
    }
  );

  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      // First install only: seed defaults if the user has nothing stored.
      // Never overwrite on update — that path used to nuke recoverable
      // user settings whenever loadSettings threw.
      try {
        const { DEFAULT_SETTINGS } = await import('../lib/types');
        await saveSettings(DEFAULT_SETTINGS);
      } catch (error) {
        logger.error('Initial settings seeding failed:', error);
      }
    } else if (details.reason === 'update') {
      // Validate without writing. If load fails we leave storage as-is so
      // the user can recover by re-saving from the options page.
      try {
        await loadSettings();
      } catch (error) {
        logger.error('Settings load failed on update; leaving storage unchanged:', error);
      }
    }
  });
});
