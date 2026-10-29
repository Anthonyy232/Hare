import { loadSettings, watchSettings, isBlacklisted } from '../lib/settings';
import { VideoController } from '../lib/controller';
import { ObserverPool } from '../lib/observer-pool';
import { createKeybindHandler, type KeybindHandler } from '../lib/keybinds';
import { createCrossFramePointerBridge, type CrossFramePointerBridge } from '../lib/cross-frame-pointer';
import { getSiteHandler } from '../lib/site-handlers';
import type { SiteHandler, HareMessage, Replies } from '../lib/types';
import { CLEANUP, SPEED } from '../lib/constants';
import { logger } from '../lib/logger';
import { SyncEndpoint } from '../lib/sync-endpoint';
import { withTimeout } from '../lib/async-utils';
import { sendToBackground } from '../lib/messaging';
import { primaryMedia } from '../lib/media-detector';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*', 'file:///*'],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',

  async main(ctx) {
    const controllers = new Map<HTMLMediaElement, VideoController>();
    // Per-media listeners: retry checks while a video is ignored, then source-change tracking once controlled.
    const mediaListeners = new Map<HTMLMediaElement, AbortController>();
    const sync = new SyncEndpoint();

    let settings = await loadSettings();
    // Embedded frames also honor the top page's exclusion.
    const pageHostname = await withTimeout(sendToBackground({ type: 'GET_PAGE_CONTEXT' }))
      .then(reply => reply.hostname ?? location.hostname, () => location.hostname);
    const isExcluded = () => isBlacklisted(settings.blacklist, location.hostname) || isBlacklisted(settings.blacklist, pageHostname);

    let siteHandler: SiteHandler | null = null;
    let observerPool: ObserverPool | null = null;
    let keybindHandler: KeybindHandler | null = null;
    let pointerBridge: CrossFramePointerBridge | null = null;
    let cleanupInterval: ReturnType<typeof setInterval> | null = null;
    let isActive = false;
    let suspended = false;

    const releaseListeners = (media: HTMLMediaElement): void => {
      mediaListeners.get(media)?.abort();
      mediaListeners.delete(media);
    };

    const listen = (media: HTMLMediaElement, types: string[], listener: () => void): void => {
      releaseListeners(media);
      const listeners = new AbortController();
      for (const type of types) media.addEventListener(type, listener, { signal: listeners.signal });
      mediaListeners.set(media, listeners);
    };

    const handleMediaFound = (media: HTMLMediaElement): void => {
      if (!isActive || !media.isConnected || controllers.has(media)) return;
      if (media instanceof HTMLAudioElement && !settings.enableAudio) return;

      if (media instanceof HTMLVideoElement && siteHandler?.shouldIgnoreVideo(media)) {
        // Late-loading players may qualify once they have dimensions or start playing.
        if (!mediaListeners.has(media)) {
          listen(media, ['loadedmetadata', 'resize', 'play', 'canplay'], () => {
            if (!siteHandler?.shouldIgnoreVideo(media)) {
              releaseListeners(media);
              handleMediaFound(media);
            }
          });
        }
        return;
      }

      controllers.set(media, new VideoController(media, settings, siteHandler));
      listen(media, ['loadstart', 'emptied', 'error'], () => {
        // A replaced, emptied, or failed source cannot keep its old sync pair.
        if (sync.isFor(media)) sync.deactivate(true);
        if (!media.isConnected) handleMediaRemoved(media);
        else controllers.get(media)?.updateSpeedDisplay();
      });
    };

    const handleMediaRemoved = (media: HTMLMediaElement): void => {
      if (sync.isFor(media)) sync.deactivate(true);
      controllers.get(media)?.destroy();
      controllers.delete(media);
      releaseListeners(media);
    };

    const connectedControllers = (): VideoController[] =>
      [...controllers.values()].filter(controller => controller.media.isConnected);

    // Recover late or shadow media on popup requests; existing controllers are skipped.
    const rescanMedia = (): void => {
      for (const media of observerPool?.observe(document) ?? []) handleMediaFound(media);
    };

    // Each frame handles its own keys; parents forward when they have no local media.
    const start = (): void => {
      if (isActive || suspended || isExcluded()) return;
      isActive = true;
      siteHandler = getSiteHandler();
      keybindHandler = createKeybindHandler(() => [...controllers.values()], () => settings);
      pointerBridge = createCrossFramePointerBridge(() => [...controllers.values()]);
      observerPool = new ObserverPool(handleMediaFound, handleMediaRemoved, settings.enableAudio);
      observerPool.observe(document);
      cleanupInterval = setInterval(() => {
        for (const media of mediaListeners.keys()) {
          if (!media.isConnected) handleMediaRemoved(media);
        }
      }, CLEANUP.STALE_CHECK_INTERVAL_MS);
    };

    const stop = (): void => {
      if (!isActive) return;
      isActive = false;
      if (cleanupInterval) clearInterval(cleanupInterval);
      cleanupInterval = null;
      observerPool?.disconnect();
      observerPool = null;
      keybindHandler?.destroy();
      keybindHandler = null;
      pointerBridge?.destroy();
      pointerBridge = null;
      sync.deactivate(true);
      for (const media of mediaListeners.keys()) handleMediaRemoved(media);
    };

    const unwatchSettings = watchSettings((newSettings) => {
      const audioChanged = settings.enableAudio !== newSettings.enableAudio;
      settings = newSettings;
      const shouldBeActive = settings.enabled && !isExcluded();

      if (shouldBeActive !== isActive) {
        if (shouldBeActive) start();
        else stop();
        return;
      }
      if (!isActive) return;
      if (audioChanged) {
        observerPool?.disconnect();
        for (const media of controllers.keys()) {
          if (media instanceof HTMLAudioElement && !settings.enableAudio) handleMediaRemoved(media);
        }
        observerPool = new ObserverPool(handleMediaFound, handleMediaRemoved, settings.enableAudio);
        observerPool.observe(document);
      }
      for (const controller of controllers.values()) controller.updateSettings(settings);
    });

    const handleMessage = async (message: HareMessage): Promise<Replies[keyof Replies]> => {
      const forEachController = (action: (controller: VideoController) => void) => {
        const targets = connectedControllers();
        targets.forEach(action);
        return { success: targets.length > 0 };
      };
      switch (message.type) {
        case 'GET_STATUS':
          rescanMedia();
          return { speeds: connectedControllers().map(controller => controller.speed) };
        case 'SET_SPEED': return forEachController(controller => controller.setSpeed(message.payload));
        case 'RESET_SPEED': return forEachController(controller => controller.setSpeed(SPEED.DEFAULT));
        case 'GET_STREAM': {
          const media = primaryMedia(connectedControllers())?.media;
          // Calls and screen shares have no link to hand over.
          if (!media || media.srcObject instanceof MediaStream) return null;
          return {
            src: /^(https?|file):/.test(media.currentSrc) ? media.currentSrc : null,
            page: location.href,
            encrypted: media.mediaKeys !== null,
            time: Number.isFinite(media.duration) ? media.currentTime : 0,
            // Covers players that started before Hare's background could see their requests.
            manifests: performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\.(m3u8|mpd)(\?|$)/.test(name)),
          };
        }
        case 'SYNC_ACTIVATE':
          rescanMedia();
          return sync.activate(connectedControllers());
        case 'SYNC_DEACTIVATE':
          sync.deactivate(false);
          return { success: true };
        case 'SYNC_GET_POSITION': return sync.getPosition();
        case 'SYNC_PAUSE':
        case 'SYNC_PLAY':
        case 'SYNC_SEEK':
        case 'SYNC_RATE':
        case 'SYNC_DRIFT_CORRECT':
          return sync.execute(message);
        default: return { success: false, error: 'Unknown message type' };
      }
    };

    const messageListener = (message: HareMessage, _sender: unknown, sendResponse: (reply: unknown) => void): true => {
      handleMessage(message).then(sendResponse, error => {
        logger.error('Message error:', error, message);
        sendResponse({ success: false, error: String(error) });
      });
      return true;
    };
    browser.runtime.onMessage.addListener(messageListener);

    if (settings.enabled) start();

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      stop();
      unwatchSettings();
      browser.runtime.onMessage.removeListener(messageListener);
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
