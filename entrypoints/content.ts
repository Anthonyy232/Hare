import { describeStream } from '../lib/export/stream';
import { HARE_MATCHES } from '../lib/hostname';
import { logger } from '../lib/logger';
import type { VideoController } from '../lib/media/controller';
import { bridgeCrossFramePointers } from '../lib/media/cross-frame-pointer';
import { primaryMedia } from '../lib/media/detector';
import { listenForParentActions } from '../lib/media/frame-actions';
import { listenForShortcuts } from '../lib/media/keybinds';
import { MediaRegistry } from '../lib/media/registry';
import { getSiteHandler } from '../lib/media/site-handlers';
import type { HareMessage, Replies } from '../lib/messages';
import { failureReply, sendToBackground, withTimeout } from '../lib/messaging';
import { DEFAULT_SETTINGS, type Settings } from '../lib/settings/schema';
import { isBlacklisted, loadSettings, watchSettings } from '../lib/settings/settings';
import { SyncEndpoint } from '../lib/sync/endpoint';

export default defineContentScript({
  matches: HARE_MATCHES,
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',

  async main(ctx) {
    const sync = new SyncEndpoint();
    const readSettings = (): Promise<Settings> =>
      loadSettings().catch(error => {
        logger.warn('Failed to load settings:', error);
        return structuredClone(DEFAULT_SETTINGS);
      });

    let settings = await readSettings();
    // Embedded frames also honor the top page's exclusion.
    const pageHostname = await withTimeout(sendToBackground({ type: 'GET_PAGE_CONTEXT' })).then(
      reply => reply.hostname ?? location.hostname,
      () => location.hostname,
    );

    let inBackForwardCache = false;
    let cleanedUp = false;
    let running: { registry: MediaRegistry; stopInput: () => void } | null = null;

    const connectedControllers = (): VideoController[] => running?.registry.connectedControllers() ?? [];

    const reconcile = (): void => {
      const shouldRun =
        settings.enabled &&
        !inBackForwardCache &&
        !cleanedUp &&
        !isBlacklisted(settings.blacklist, location.hostname) &&
        !isBlacklisted(settings.blacklist, pageHostname);
      if (running && !shouldRun) {
        running.stopInput();
        sync.deactivate(true);
        running.registry.destroy();
        running = null;
      } else if (!running && shouldRun) {
        const registry = new MediaRegistry(settings, getSiteHandler(), media => {
          if (sync.isFor(media)) sync.deactivate(true);
        });
        const stops = [
          listenForShortcuts(connectedControllers, () => settings.keyBindings),
          bridgeCrossFramePointers(connectedControllers),
          listenForParentActions(connectedControllers),
        ];
        running = { registry, stopInput: () => stops.forEach(stop => stop()) };
      } else {
        running?.registry.updateSettings(settings);
      }
    };

    const unwatchSettings = watchSettings(newSettings => {
      settings = newSettings;
      reconcile();
    });

    const handleMessage = async (message: HareMessage): Promise<Replies[keyof Replies]> => {
      switch (message.type) {
        case 'GET_STATUS':
          running?.registry.rescan();
          return { speeds: connectedControllers().map(controller => controller.speed) };
        case 'SET_SPEED': {
          const targets = connectedControllers();
          for (const controller of targets) controller.setSpeed(message.payload);
          return { success: targets.length > 0 };
        }
        case 'GET_STREAM': {
          const media = primaryMedia(connectedControllers())?.media;
          return media ? describeStream(media) : null;
        }
        default: {
          const findControllers = () => {
            running?.registry.rescan();
            return connectedControllers();
          };
          return sync.handle(message, findControllers) ?? { success: false, error: 'Unknown message type' };
        }
      }
    };

    const messageListener = (message: HareMessage, _sender: unknown, sendResponse: (reply: unknown) => void): true => {
      handleMessage(message).then(sendResponse, error => {
        logger.error('Message error:', error, message);
        sendResponse(failureReply(error));
      });
      return true;
    };
    browser.runtime.onMessage.addListener(messageListener);

    reconcile();

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      reconcile();
      unwatchSettings();
      browser.runtime.onMessage.removeListener(messageListener);
    };

    const handlePageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) return cleanup();
      inBackForwardCache = true;
      reconcile();
    };
    const handlePageShow = async (event: PageTransitionEvent) => {
      if (!event.persisted || cleanedUp) return;
      // Cleared first so a pagehide during the read puts the page back in the cache.
      inBackForwardCache = false;
      settings = await readSettings();
      reconcile();
    };
    ctx.onInvalidated(cleanup);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
  },
});
