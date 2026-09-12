import { loadSettings, watchSettings, isBlacklisted } from '../lib/settings';
import { VideoController } from '../lib/controller';
import { ObserverPool } from '../lib/observer-pool';
import { isValidMedia } from '../lib/media-detector';
import { createKeybindHandler, type KeybindHandler } from '../lib/keybinds';
import { createCrossFramePointerBridge, type CrossFramePointerBridge } from '../lib/cross-frame-pointer';
import { getSiteHandler } from '../lib/site-handlers';
import type { SiteHandler, HareMessage } from '../lib/types';
import { CLEANUP } from '../lib/constants';
import type { Browser } from 'wxt/browser';
import { logger } from '../lib/logger';
import { isTopFrame } from '../lib/browser-detect';
import { SyncAgent } from '../lib/sync-agent';
import { safeMedia } from '../lib/safe-media';
import { withTimeout } from '../lib/async-utils';
import { SYNC, type SyncEventPayload, type SyncCommandPayload, type DriftCorrectPayload } from '../lib/sync-types';

const SYNC_EVENT_TYPE: Record<SyncEventPayload['action'], string> = {
  pause: 'SYNC_PAUSE',
  play: 'SYNC_PLAY',
  seek: 'SYNC_SEEK',
  ratechange: 'SYNC_RATE',
  buffering_start: 'SYNC_BUFFERING',
  buffering_end: 'SYNC_BUFFERING',
};

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*', 'file:///*'],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',

  async main(ctx) {
    const controllers = new Map<HTMLMediaElement, VideoController>();
    const mediaLoadstartListeners = new Map<HTMLMediaElement, () => void>();
    const deferredVideoListeners = new Map<HTMLMediaElement, { listener: () => void }>();

    let settings = await loadSettings();
    const pageHostname: string = await withTimeout(browser.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' }))
      .then(response => typeof response?.hostname === 'string' ? response.hostname : location.hostname)
      .catch(() => location.hostname);
    const isExcluded = () => isBlacklisted(settings.blacklist, location.hostname) || isBlacklisted(settings.blacklist, pageHostname);

    logger.debug('Content script initialized', {
      enabled: settings.enabled,
      hostname: location.hostname,
      isBlacklisted: isBlacklisted(settings.blacklist, location.hostname),
      isTopFrame: isTopFrame()
    });

    let siteHandler: SiteHandler | null = null;
    let observerPool: ObserverPool | null = null;
    let keybindHandler: KeybindHandler | null = null;
    let pointerBridge: CrossFramePointerBridge | null = null;
    let cleanupInterval: NodeJS.Timeout | null = null;
    let isActive = false;
    let suspended = false;
    let syncAgent: SyncAgent | null = null;
    let syncKeepAlivePort: ReturnType<typeof browser.runtime.connect> | null = null;
    let syncKeepAliveReconnectTimer: NodeJS.Timeout | null = null;
    let syncKeepAlivePingTimer: NodeJS.Timeout | null = null;

    /**
     * Open (or replace) the keep-alive port and arm the periodic-reconnect /
     * ping timers. The port instance is short-lived: Chrome enforces a hard
     * cap (~5 minutes) on a single connect() before forcibly disconnecting it,
     * so we reconnect well before that. The 20s ping resets the SW's 30s
     * idle timer continuously between drift checks.
     */
    const openSyncKeepAlive = (): void => {
      if (syncKeepAlivePort) {
        try { syncKeepAlivePort.disconnect(); } catch { /* already gone */ }
        syncKeepAlivePort = null;
      }
      try {
        syncKeepAlivePort = browser.runtime.connect({ name: 'sync-keepalive' });
      } catch (error) {
        logger.warn('sync-keepalive connect failed:', error);
        return;
      }
      syncKeepAlivePort.onDisconnect.addListener(() => {
        // Note: don't auto-reopen here — the reconnect timer below handles
        // scheduled rotation, and unexpected disconnects (extension reload,
        // tab unload) shouldn't trigger respawn loops.
        syncKeepAlivePort = null;
      });
    };

    const startSyncKeepAlive = (): void => {
      stopSyncKeepAlive();
      openSyncKeepAlive();
      syncKeepAliveReconnectTimer = setInterval(() => {
        openSyncKeepAlive();
      }, SYNC.KEEPALIVE_RECONNECT_MS);
      syncKeepAlivePingTimer = setInterval(() => {
        if (!syncKeepAlivePort) return;
        try {
          syncKeepAlivePort.postMessage({ type: 'PING' });
        } catch {
          // Port died between ticks; the next reconnect tick will recover.
          syncKeepAlivePort = null;
        }
      }, SYNC.KEEPALIVE_PING_MS);
    };

    const stopSyncKeepAlive = (): void => {
      if (syncKeepAliveReconnectTimer) {
        clearInterval(syncKeepAliveReconnectTimer);
        syncKeepAliveReconnectTimer = null;
      }
      if (syncKeepAlivePingTimer) {
        clearInterval(syncKeepAlivePingTimer);
        syncKeepAlivePingTimer = null;
      }
      if (syncKeepAlivePort) {
        try { syncKeepAlivePort.disconnect(); } catch { /* already gone */ }
        syncKeepAlivePort = null;
      }
    };

    const deactivateLocalSync = (notifyCoordinator: boolean): void => {
      const hadSyncAgent = !!syncAgent;
      if (syncAgent) {
        syncAgent.destroy();
        syncAgent = null;
      }
      for (const c of controllers.values()) c.setIntendedSpeedListener(null);
      stopSyncKeepAlive();

      if (notifyCoordinator && hadSyncAgent) {
        browser.runtime.sendMessage({ type: 'STOP_SYNC' }).catch(() => {});
      }
    };

    /**
     * Instantiates a new controller for discovered media, applying site-specific
     * filters and setting up listeners for dynamic source changes.
     */
    const handleMediaFound = (media: HTMLMediaElement): void => {
      if (!isActive || !media.isConnected) return;
      if (controllers.has(media)) return;

      if (media instanceof HTMLAudioElement && !settings.enableAudio) return;

      if (media instanceof HTMLVideoElement && siteHandler?.shouldIgnoreVideo(media)) {
        if (!deferredVideoListeners.has(media)) {
          const retryCheck = () => {
            if (!siteHandler?.shouldIgnoreVideo(media)) {
              cleanupDeferredListener(media);
              handleMediaFound(media);
            }
          };

          media.addEventListener('loadedmetadata', retryCheck);
          media.addEventListener('resize', retryCheck);
          media.addEventListener('play', retryCheck);
          media.addEventListener('canplay', retryCheck);

          // Keep retries for late-loading players. Removal and stop() explicitly release them.
          deferredVideoListeners.set(media, { listener: retryCheck });
        }
        return;
      }

      if (!isValidMedia(media)) return;

      cleanupDeferredListener(media);

      const controller = new VideoController(media, settings, siteHandler);
      controllers.set(media, controller);
      logger.debug('Controller created for media element', {
        tagName: media.tagName,
        src: media.src || media.currentSrc,
        totalControllers: controllers.size
      });

      const loadstartHandler = () => {
        // Reusing a video node for another episode invalidates the paired starting positions.
        if (syncAgent?.isForMedia(media)) deactivateLocalSync(true);
        const controller = controllers.get(media);

        if (controller && !isValidMedia(media)) {
          handleMediaRemoved(media);
        } else if (!controller && isValidMedia(media)) {
          handleMediaFound(media);
        } else if (controller && isValidMedia(media)) {
          // Media source changed but element is reused (common on SPAs like YouTube)
          // Sync the display to reflect the new video's playback rate
          controller.updateSpeedDisplay();
        }
      };
      media.addEventListener('loadstart', loadstartHandler);
      mediaLoadstartListeners.set(media, loadstartHandler);
    };

    const cleanupDeferredListener = (media: HTMLMediaElement): void => {
      const entry = deferredVideoListeners.get(media);
      if (entry) {
        const { listener } = entry;
        media.removeEventListener('loadedmetadata', listener);
        media.removeEventListener('resize', listener);
        media.removeEventListener('play', listener);
        media.removeEventListener('canplay', listener);
        deferredVideoListeners.delete(media);
      }
    };

    const handleMediaRemoved = (media: HTMLMediaElement): void => {
      if (syncAgent?.isForMedia(media)) {
        deactivateLocalSync(true);
      }

      const controller = controllers.get(media);
      if (controller) {
        controller.destroy();
        controllers.delete(media);
      }

      const loadstartHandler = mediaLoadstartListeners.get(media);
      if (loadstartHandler) {
        media.removeEventListener('loadstart', loadstartHandler);
        mediaLoadstartListeners.delete(media);
      }

      cleanupDeferredListener(media);
    };

    /**
     * Re-scans the DOM for media elements and registers any that the initial
     * scan / MutationObserver missed (deferred-ignore videos that timed out,
     * SPA-swapped videos, shadow-DOM additions). Idempotent: existing
     * controllers are skipped by `handleMediaFound`. Called on-demand from
     * popup-driven message handlers so the user never has to disable / re-
     * enable the extension to make tabs appear in Sync Mode.
     */
    const rescanMedia = (): void => {
      if (!isActive) return;
      for (const media of observerPool?.observe(document) ?? []) {
        handleMediaFound(media);
      }
    };

    /**
     * Initializes the observer pool and keybind handlers.
     * Each frame handles its own keys; parents forward only when they have no local media.
     */
    const start = (): void => {
      if (isActive || suspended) return;
      if (isExcluded()) return;

      isActive = true;
      siteHandler = getSiteHandler();

      keybindHandler = createKeybindHandler(
        () => [...controllers.values()],
        () => settings
      );

      observerPool = new ObserverPool(handleMediaFound, handleMediaRemoved, settings.enableAudio);

      pointerBridge = createCrossFramePointerBridge(() => [...controllers.values()]);

      const existingMedia = observerPool.observe(document);
      logger.debug('Initial media scan complete', {
        foundCount: existingMedia.length,
        siteHandler: siteHandler?.constructor.name || 'none'
      });
      cleanupInterval = setInterval(() => {
        for (const [media] of controllers.entries()) {
          if (!media.isConnected) handleMediaRemoved(media);
        }
        for (const media of deferredVideoListeners.keys()) {
          if (!media.isConnected) cleanupDeferredListener(media);
        }
      }, CLEANUP.STALE_CHECK_INTERVAL_MS);
    };

    const stop = (): void => {
      if (!isActive) return;
      isActive = false;

      if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
      }

      observerPool?.disconnect();
      observerPool = null;

      keybindHandler?.destroy();
      keybindHandler = null;

      pointerBridge?.destroy();
      pointerBridge = null;

      deactivateLocalSync(true);

      for (const media of controllers.keys()) handleMediaRemoved(media);
      for (const media of deferredVideoListeners.keys()) cleanupDeferredListener(media);
    };

    const unwatchSettings = watchSettings((newSettings) => {
      const audioChanged = settings.enableAudio !== newSettings.enableAudio;
      settings = newSettings;
      const shouldBeActive = settings.enabled && !isExcluded();

      if (shouldBeActive && !isActive) {
        start();
      } else if (!shouldBeActive && isActive) {
        stop();
      } else if (isActive) {
        if (audioChanged) {
          observerPool?.disconnect();
          for (const media of controllers.keys()) {
            if (media instanceof HTMLAudioElement && !settings.enableAudio) handleMediaRemoved(media);
          }
          observerPool = new ObserverPool(handleMediaFound, handleMediaRemoved, settings.enableAudio);
          observerPool.observe(document);
        }
        for (const controller of controllers.values()) {
          controller.updateSettings(settings);
        }
      }
    });

    /**
     * Routes remote messages from the popup or background script to active controllers.
     */
    const messageHandler = (
      message: HareMessage,
      _sender: Browser.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ): true => {
      let controllersArray = [...controllers.values()].filter(c => c.media.isConnected);

      try {
        switch (message.type) {
          case 'GET_STATUS': {
            // Self-heal: if we have nothing tracked, re-scan the DOM. Catches
            // videos missed by the initial scan or the MutationObserver
            // (deferred-ignore timeouts, late SPA additions, shadow DOM, etc.)
            // so the user doesn't need to disable / re-enable the extension.
            rescanMedia();
            controllersArray = [...controllers.values()].filter(c => c.media.isConnected);
            sendResponse({
              hasVideos: controllersArray.length > 0,
              currentSpeed: controllersArray[0]?.speed ?? 1.0,
              videoCount: controllersArray.length,
              mixedSpeeds: controllersArray.some(c => Math.abs(c.speed - controllersArray[0].speed) > 0.001),
              enabled: settings.enabled,
              excluded: isExcluded(),
            });
            break;
          }

          case 'SET_SPEED': {
            const speed = message.payload as number;
            if (typeof speed !== 'number' || !Number.isFinite(speed)) {
              sendResponse({ success: false, error: 'Invalid speed' });
              break;
            }
            for (const controller of controllersArray) controller.setSpeed(speed);
            sendResponse({ success: controllersArray.length > 0 });
            break;
          }

          case 'ADJUST_SPEED': {
            const delta = message.payload as number;
            if (typeof delta !== 'number' || !Number.isFinite(delta)) {
              sendResponse({ success: false, error: 'Invalid delta' });
              break;
            }
            for (const controller of controllersArray) controller.adjustSpeed(delta);
            sendResponse({ success: controllersArray.length > 0 });
            break;
          }

          case 'RESET_SPEED': {
            for (const controller of controllersArray) controller.resetSpeed();
            sendResponse({ success: controllersArray.length > 0 });
            break;
          }

          case 'TOGGLE_DISPLAY': {
            for (const controller of controllersArray) controller.toggleVisibility();
            sendResponse({ success: controllersArray.length > 0 });
            break;
          }

          case 'SYNC_ACTIVATE': {
            deactivateLocalSync(false);
            // Rescan first so a tab that was previously invisible to GET_STATUS
            // (deferred-ignore timeout, late SPA addition, etc.) can still
            // activate sync without the user disabling and re-enabling the
            // extension.
            rescanMedia();
            const candidates = [...controllers.keys()].filter(media => media.isConnected && media.readyState >= 1);
            candidates.sort((a, b) => {
              if (a.paused !== b.paused) return a.paused ? 1 : -1;
              const rectA = a.getBoundingClientRect(), rectB = b.getBoundingClientRect();
              return rectB.width * rectB.height - rectA.width * rectA.height;
            });
            const primaryMedia = candidates[0];
            if (!primaryMedia) {
              sendResponse({ success: false, error: 'No video found' });
              break;
            }
            const primaryController = controllers.get(primaryMedia);
            const baseRate = primaryController?.intendedSpeed
              ?? safeMedia.getPlaybackRate(primaryMedia);
            syncAgent = new SyncAgent(
              primaryMedia,
              (event: SyncEventPayload) => {
                browser.runtime.sendMessage({
                  type: SYNC_EVENT_TYPE[event.action],
                  payload: event,
                }).catch(() => {});
              },
              baseRate,
              // Coordinator-issued rate changes route through the controller so
              // enforcement state (targetSpeed / isEnforcingSpeed) stays consistent.
              primaryController
                ? (rate: number) => primaryController.setSpeed(rate)
                : (rate: number) => safeMedia.setPlaybackRate(primaryMedia, rate),
              primaryController
                ? (rate: number) => primaryController.applyTransientRate(rate)
                : (rate: number) => safeMedia.setPlaybackRate(primaryMedia, rate),
            );
            // User-initiated speed changes (keybind, popup) flow controller -> agent.
            if (primaryController) {
              primaryController.setIntendedSpeedListener((rate) => {
                syncAgent?.notifyIntendedSpeedChange(rate);
              });
            }
            startSyncKeepAlive();
            sendResponse({
              success: true,
              currentTime: safeMedia.getCurrentTime(primaryMedia),
              playbackRate: baseRate,
              paused: primaryMedia.paused,
              timestamp: Date.now(),
            });
            break;
          }

          case 'SYNC_DEACTIVATE': {
            deactivateLocalSync(false);
            sendResponse({ success: true });
            break;
          }

          case 'SYNC_PAUSE': {
            if (!syncAgent) { sendResponse({ success: false }); break; }
            const pauseCmd = message.payload as SyncCommandPayload;
            // Source was paused at command time and isn't advancing — don't
            // time-compensate. Skip the seek if we're already close enough to
            // avoid visible jitter when both tabs are already in sync.
            const localPos = syncAgent.getPosition().currentTime;
            const driftSec = SYNC.DRIFT_IGNORE_THRESHOLD_MS / 1000;
            if (pauseCmd.position >= 0 && Math.abs(localPos - pauseCmd.position) > driftSec) {
              syncAgent.executeSeek(pauseCmd.position);
            }
            syncAgent.executePause();
            sendResponse({ success: true });
            break;
          }

          case 'SYNC_PLAY': {
            if (!syncAgent) { sendResponse({ success: false }); break; }
            const playCmd = message.payload as SyncCommandPayload;
            // position -1 means "resume without seeking" (e.g., buffering recovery)
            if (playCmd.position >= 0) {
              // Source was playing — extrapolate using its rate (preferred) or
              // fall back to local rate.
              const rate = playCmd.rate
                ?? syncAgent.getPosition().playbackRate
                ?? 1.0;
              const compensatedPlayPos = playCmd.position + rate * (Date.now() - playCmd.timestamp) / 1000;
              syncAgent.executeSeek(compensatedPlayPos);
            }
            void syncAgent.executePlay().then(success => sendResponse({ success }));
            break;
          }

          case 'SYNC_SEEK': {
            if (!syncAgent) { sendResponse({ success: false }); break; }
            const seekCmd = message.payload as SyncCommandPayload;
            // Seek is to an absolute position — no timestamp compensation needed
            syncAgent.executeSeek(seekCmd.position);
            sendResponse({ success: true });
            break;
          }

          case 'SYNC_RATE': {
            if (!syncAgent) { sendResponse({ success: false }); break; }
            const rateCmd = message.payload as SyncCommandPayload;
            if (typeof rateCmd.rate === 'number' && Number.isFinite(rateCmd.rate) && rateCmd.rate > 0) {
              syncAgent.executeRateChange(rateCmd.rate);
              sendResponse({ success: Math.abs(syncAgent.getPosition().playbackRate - rateCmd.rate) < 0.001 });
            } else {
              sendResponse({ success: false, error: 'Invalid speed' });
            }
            break;
          }

          case 'SYNC_DRIFT_CORRECT': {
            if (!syncAgent) { sendResponse({ success: false }); break; }
            const drift = message.payload as DriftCorrectPayload;
            if (drift.method === 'seek') {
              syncAgent.executeSeek(drift.position);
            } else if (drift.method === 'rate') {
              syncAgent.applyRateCorrection(
                drift.rateFactor ?? 0.02,
                drift.durationMs ?? 3000,
              );
            }
            sendResponse({ success: true });
            break;
          }

          case 'SYNC_GET_POSITION': {
            sendResponse(syncAgent ? syncAgent.getPosition() : null);
            break;
          }

          default:
            sendResponse({ success: false, error: 'Unknown message type' });
        }
      } catch (error) {
        logger.error('Message error:', error, message);
        sendResponse({ success: false, error: String(error) });
      }

      return true;
    };

    browser.runtime.onMessage.addListener(messageHandler);

    if (settings.enabled) start();

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;

      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      stop();
      unwatchSettings();
      browser.runtime.onMessage.removeListener(messageHandler);
    };

    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted) { suspended = true; stop(); }
      else cleanup();
    };
    const handlePageShow = async (event: PageTransitionEvent) => {
      if (!event.persisted || cleanedUp) return;
      settings = await loadSettings();
      suspended = false;
      if (!cleanedUp && settings.enabled) start();
    };
    ctx.onInvalidated(cleanup);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
  },
});
