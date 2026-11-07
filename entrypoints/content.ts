import { loadSettings, watchSettings, isBlacklisted } from '../lib/settings';
import type { VideoController } from '../lib/controller';
import { MediaRegistry } from '../lib/media-registry';
import { createKeybindHandler, type KeybindHandler } from '../lib/keybinds';
import { createCrossFramePointerBridge, type CrossFramePointerBridge } from '../lib/cross-frame-pointer';
import { getSiteHandler } from '../lib/site-handlers';
import type { HareMessage, Replies } from '../lib/messages';
import { SPEED } from '../lib/constants';
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
    const sync = new SyncEndpoint();

    let settings = await loadSettings();
    // Embedded frames also honor the top page's exclusion.
    const pageHostname = await withTimeout(sendToBackground({ type: 'GET_PAGE_CONTEXT' }))
      .then(reply => reply.hostname ?? location.hostname, () => location.hostname);
    const isExcluded = () => isBlacklisted(settings.blacklist, location.hostname) || isBlacklisted(settings.blacklist, pageHostname);

    let mediaRegistry: MediaRegistry | null = null;
    let keybindHandler: KeybindHandler | null = null;
    let pointerBridge: CrossFramePointerBridge | null = null;
    let isActive = false;
    let suspended = false;

    const connectedControllers = (): VideoController[] => mediaRegistry?.connectedControllers() ?? [];

    const start = (): void => {
      if (isActive || suspended || isExcluded()) return;
      isActive = true;
      mediaRegistry = new MediaRegistry(settings, getSiteHandler(), media => {
        if (sync.isFor(media)) sync.deactivate(true);
      });
      keybindHandler = createKeybindHandler(connectedControllers, () => settings);
      pointerBridge = createCrossFramePointerBridge(connectedControllers);
    };

    const stop = (): void => {
      if (!isActive) return;
      isActive = false;
      keybindHandler?.destroy();
      keybindHandler = null;
      pointerBridge?.destroy();
      pointerBridge = null;
      sync.deactivate(true);
      mediaRegistry?.destroy();
      mediaRegistry = null;
    };

    const unwatchSettings = watchSettings((newSettings) => {
      settings = newSettings;
      const shouldBeActive = settings.enabled && !isExcluded();

      if (shouldBeActive !== isActive) {
        if (shouldBeActive) start();
        else stop();
        return;
      }
      if (!isActive) return;
      mediaRegistry?.updateSettings(settings);
    });

    const handleMessage = async (message: HareMessage): Promise<Replies[keyof Replies]> => {
      const forEachController = (action: (controller: VideoController) => void) => {
        const targets = connectedControllers();
        targets.forEach(action);
        return { success: targets.length > 0 };
      };
      switch (message.type) {
        case 'GET_STATUS':
          mediaRegistry?.rescan();
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
          mediaRegistry?.rescan();
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
