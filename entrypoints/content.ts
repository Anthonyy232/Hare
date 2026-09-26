import { loadSettings, watchSettings, isBlacklisted } from '../lib/settings';
import { VideoController } from '../lib/controller';
import { ObserverPool } from '../lib/observer-pool';
import { createKeybindHandler, type KeybindHandler } from '../lib/keybinds';
import { createCrossFramePointerBridge, type CrossFramePointerBridge } from '../lib/cross-frame-pointer';
import { getSiteHandler } from '../lib/site-handlers';
import type { SiteHandler, HareMessage } from '../lib/types';
import { CLEANUP } from '../lib/constants';
import type { Browser } from 'wxt/browser';
import { logger } from '../lib/logger';
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
    const mediaLifecycleListeners = new Map<HTMLMediaElement, AbortController>();
    const deferredVideoListeners = new Map<HTMLMediaElement, AbortController>();

    let settings = await loadSettings();
    const pageHostname: string = await withTimeout(browser.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' }))
      .then(response => typeof response?.hostname === 'string' ? response.hostname : location.hostname)
      .catch(() => location.hostname);
    const isExcluded = () => isBlacklisted(settings.blacklist, location.hostname) || isBlacklisted(settings.blacklist, pageHostname);

    logger.debug('Content script initialized', {
      enabled: settings.enabled,
      hostname: location.hostname,
      isBlacklisted: isBlacklisted(settings.blacklist, location.hostname),
      isTopFrame: window === window.top
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

    // Ping and periodically rotate the port while sync is active.
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
        // Let scheduled rotation reconnect; immediate retries can loop during unload.
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

    const handleMediaFound = (media: HTMLMediaElement): void => {
      if (!isActive || !media.isConnected) return;
      if (controllers.has(media)) return;

      if (media instanceof HTMLAudioElement && !settings.enableAudio) return;

      if (media instanceof HTMLVideoElement && siteHandler?.shouldIgnoreVideo(media)) {
        if (!deferredVideoListeners.has(media)) {
          const listeners = new AbortController();
          const { signal } = listeners;
          const retryCheck = () => {
            if (!siteHandler?.shouldIgnoreVideo(media)) {
              cleanupDeferredListener(media);
              handleMediaFound(media);
            }
          };

          media.addEventListener('loadedmetadata', retryCheck, { signal });
          media.addEventListener('resize', retryCheck, { signal });
          media.addEventListener('play', retryCheck, { signal });
          media.addEventListener('canplay', retryCheck, { signal });

          // Keep retries for late-loading players. Removal and stop() explicitly release them.
          deferredVideoListeners.set(media, listeners);
        }
        return;
      }

      cleanupDeferredListener(media);

      const controller = new VideoController(media, settings, siteHandler);
      controllers.set(media, controller);
      logger.debug('Controller created for media element', {
        tagName: media.tagName,
        src: media.src || media.currentSrc,
        totalControllers: controllers.size
      });

      const sourceChanged = () => {
        // A replaced, emptied, or failed source cannot keep its old sync pair.
        if (syncAgent?.isForMedia(media)) deactivateLocalSync(true);
        const controller = controllers.get(media);

        if (!media.isConnected) {
          handleMediaRemoved(media);
        } else if (!controller) {
          handleMediaFound(media);
        } else {
          controller.updateSpeedDisplay();
        }
      };
      const listeners = new AbortController();
      for (const type of ['loadstart', 'emptied', 'error']) {
        media.addEventListener(type, sourceChanged, { signal: listeners.signal });
      }
      mediaLifecycleListeners.set(media, listeners);
    };

    const cleanupDeferredListener = (media: HTMLMediaElement): void => {
      deferredVideoListeners.get(media)?.abort();
      deferredVideoListeners.delete(media);
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

      mediaLifecycleListeners.get(media)?.abort();
      mediaLifecycleListeners.delete(media);

      cleanupDeferredListener(media);
    };

    // Recover late or shadow media on popup requests; existing controllers are skipped.
    const rescanMedia = (): void => {
      if (!isActive) return;
      for (const media of observerPool?.observe(document) ?? []) {
        handleMediaFound(media);
      }
    };

    // Each frame handles its own keys; parents forward when they have no local media.
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

    const messageHandler = (
      message: HareMessage,
      _sender: Browser.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ): true => {
      let controllersArray = [...controllers.values()].filter(c => c.media.isConnected);

      try {
        switch (message.type) {
          case 'GET_STATUS': {
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
            rescanMedia();
            const candidates = [...controllers.keys()].filter(media => media.isConnected && media.readyState >= HTMLMediaElement.HAVE_METADATA);
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
              // Keep controller enforcement consistent with remote rate changes.
              primaryController
                ? (rate: number) => primaryController.setSpeed(rate)
                : (rate: number) => safeMedia.setPlaybackRate(primaryMedia, rate),
              primaryController
                ? (rate: number) => primaryController.applyTransientRate(rate)
                : (rate: number) => safeMedia.setPlaybackRate(primaryMedia, rate),
            );
            if (primaryController) {
              primaryController.setIntendedSpeedListener((rate) => {
                syncAgent?.notifyIntendedSpeedChange(rate);
              });
            }
            startSyncKeepAlive();
            sendResponse({
              success: true,
              ...syncAgent.getPosition(),
              playbackRate: baseRate,
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
            // Do not extrapolate a paused source; skip tiny seeks to avoid visible jitter.
            const localPos = syncAgent.getPosition().currentTime;
            const driftSec = SYNC.DRIFT_IGNORE_THRESHOLD_MS / 1000;
            if (pauseCmd.position >= 0 && Math.abs(localPos - pauseCmd.position) > driftSec) {
              syncAgent.executeSeek(pauseCmd.position);
            }
            syncAgent.executePause(pauseCmd.buffering === true);
            sendResponse({ success: true });
            break;
          }

          case 'SYNC_PLAY': {
            if (!syncAgent) { sendResponse({ success: false }); break; }
            const playCmd = message.payload as SyncCommandPayload;
            if (playCmd.position >= 0) {
              const rate = playCmd.rate ?? syncAgent.getPosition().playbackRate;
              const compensatedPlayPos = playCmd.position + rate * (Date.now() - playCmd.timestamp) / 1000;
              if (Math.abs(syncAgent.getPosition().currentTime - compensatedPlayPos) > SYNC.DRIFT_IGNORE_THRESHOLD_MS / 1000) {
                syncAgent.executeSeek(compensatedPlayPos);
              }
            }
            void syncAgent.executePlay().then(success => sendResponse({ success }));
            break;
          }

          case 'SYNC_SEEK': {
            if (!syncAgent) { sendResponse({ success: false }); break; }
            const seekCmd = message.payload as SyncCommandPayload;
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
