import { loadSettings, watchSettings, isBlacklisted } from '../lib/settings';
import { VideoController } from '../lib/controller';
import { ObserverPool } from '../lib/observer-pool';
import { findAllMedia, isValidMedia } from '../lib/media-detector';
import { createKeybindHandler, type KeybindHandler } from '../lib/keybinds';
import { getSiteHandler } from '../lib/site-handlers';
import type { Settings, SiteHandler, StatusResponse, HareMessage } from '../lib/types';
import { CLEANUP } from '../lib/constants';
import type { Browser } from 'wxt/browser';
import { logger } from '../lib/logger';

/**
 * Tracks event listeners for cleanup without preventing garbage collection of the media element.
 */
const mediaLoadstartListeners = new WeakMap<HTMLMediaElement, () => void>();
const deferredVideoListeners = new WeakMap<HTMLMediaElement, { listener: () => void; timeout: NodeJS.Timeout }>();

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*', 'file:///*'],
  excludeMatches: ['*://meet.google.com/*', '*://hangouts.google.com/*'],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',

  async main(ctx) {
    const controllers = new Map<HTMLMediaElement, VideoController>();

    let settings = await loadSettings();
    logger.debug('Content script initialized', {
      enabled: settings.enabled,
      hostname: location.hostname,
      isBlacklisted: isBlacklisted(settings.blacklist, location.hostname),
      isTopFrame: window === window.top
    });

    let siteHandler: SiteHandler | null = null;
    let observerPool: ObserverPool | null = null;
    let keybindHandler: KeybindHandler | null = null;
    let cleanupInterval: NodeJS.Timeout | null = null;
    let isActive = false;

    /**
     * Instantiates a new controller for discovered media, applying site-specific
     * filters and setting up listeners for dynamic source changes.
     */
    const handleMediaFound = (media: HTMLMediaElement): void => {
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

          // Auto-cleanup after timeout to prevent memory leaks
          const timeout = setTimeout(() => {
            cleanupDeferredListener(media);
          }, CLEANUP.DEFERRED_VIDEO_TIMEOUT_MS);

          deferredVideoListeners.set(media, { listener: retryCheck, timeout });
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
        if (controllers.has(media) && !isValidMedia(media)) {
          handleMediaRemoved(media);
        } else if (!controllers.has(media) && isValidMedia(media)) {
          handleMediaFound(media);
        }
      };
      media.addEventListener('loadstart', loadstartHandler);
      mediaLoadstartListeners.set(media, loadstartHandler);
    };

    const cleanupDeferredListener = (media: HTMLMediaElement): void => {
      const entry = deferredVideoListeners.get(media);
      if (entry) {
        const { listener, timeout } = entry;
        clearTimeout(timeout);
        media.removeEventListener('loadedmetadata', listener);
        media.removeEventListener('resize', listener);
        media.removeEventListener('play', listener);
        media.removeEventListener('canplay', listener);
        deferredVideoListeners.delete(media);
      }
    };

    const handleMediaRemoved = (media: HTMLMediaElement): void => {
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
     * Initializes the observer pool and keybind handlers. 
     * Restricted to top-frame for keybinds to avoid duplicate execution.
     */
    const start = (): void => {
      if (isActive) return;
      if (isBlacklisted(settings.blacklist, location.hostname)) return;

      isActive = true;
      siteHandler = getSiteHandler();

      if (window === window.top) {
        keybindHandler = createKeybindHandler(
          () => [...controllers.values()],
          () => settings
        );
      }

      observerPool = new ObserverPool(handleMediaFound, handleMediaRemoved, settings.enableAudio);

      const existingMedia = findAllMedia(document, settings.enableAudio);
      logger.debug('Initial media scan complete', {
        foundCount: existingMedia.length,
        siteHandler: siteHandler?.constructor.name || 'none'
      });
      for (const media of existingMedia) {
        handleMediaFound(media);
      }

      observerPool.observe(document);

      cleanupInterval = setInterval(() => {
        for (const [media] of controllers.entries()) {
          if (!media.isConnected) handleMediaRemoved(media);
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

      for (const controller of controllers.values()) {
        controller.destroy();
      }
      controllers.clear();
    };

    const unwatchSettings = watchSettings((newSettings) => {
      settings = newSettings;
      const shouldBeActive = settings.enabled && !isBlacklisted(settings.blacklist, location.hostname);

      if (shouldBeActive && !isActive) {
        start();
      } else if (!shouldBeActive && isActive) {
        stop();
      } else if (isActive) {
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
      const controllersArray = [...controllers.values()].filter(c => c.media.isConnected);

      try {
        switch (message.type) {
          case 'GET_STATUS': {
            sendResponse({
              hasVideos: controllersArray.length > 0,
              currentSpeed: controllersArray[0]?.speed ?? 1.0,
              videoCount: controllersArray.length,
            });
            break;
          }

          case 'SET_SPEED': {
            const speed = message.payload as number;
            if (typeof speed !== 'number' || isNaN(speed)) {
              sendResponse({ success: false, error: 'Invalid speed' });
              break;
            }
            for (const controller of controllersArray) controller.setSpeed(speed);
            sendResponse({ success: true });
            break;
          }

          case 'ADJUST_SPEED': {
            const delta = message.payload as number;
            if (typeof delta !== 'number' || isNaN(delta)) {
              sendResponse({ success: false, error: 'Invalid delta' });
              break;
            }
            for (const controller of controllersArray) controller.adjustSpeed(delta);
            sendResponse({ success: true });
            break;
          }

          case 'RESET_SPEED': {
            for (const controller of controllersArray) controller.resetSpeed();
            sendResponse({ success: true });
            break;
          }

          case 'TOGGLE_DISPLAY': {
            for (const controller of controllersArray) controller.toggleVisibility();
            sendResponse({ success: true });
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

      window.removeEventListener('pagehide', cleanup);
      stop();
      unwatchSettings();
      browser.runtime.onMessage.removeListener(messageHandler);
    };

    ctx.onInvalidated(cleanup);
    window.addEventListener('pagehide', cleanup);
  },
});
