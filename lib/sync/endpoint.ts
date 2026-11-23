import { browser, type Browser } from 'wxt/browser';
import type { VideoController } from '../media/controller';
import { primaryMedia } from '../media/detector';
import type { HareMessage, Replies } from '../messages';
import { sendToBackground } from '../messaging';
import { SyncAgent } from './agent';
import { isSyncCommand, runSyncCommand } from './commands';
import { KEEPALIVE_PORT } from './types';

// Reopen the port before Chrome's five-minute cap closes it, and ping before the worker goes idle.
const KEEPALIVE_RECONNECT_MS = 240_000;
const KEEPALIVE_PING_MS = 20_000;

/** A content frame's side of a sync pair: the one media element it syncs, and the port that keeps sync alive. */
export class SyncEndpoint {
  private agent: SyncAgent | null = null;
  private port: Browser.runtime.Port | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];

  isFor(media: HTMLMediaElement): boolean {
    return this.agent?.media === media;
  }

  /** Replies to sync's messages; null for messages that aren't sync's. */
  handle(message: HareMessage, findControllers: () => VideoController[]): Promise<Replies[keyof Replies]> | null {
    switch (message.type) {
      case 'SYNC_ACTIVATE': return Promise.resolve(this.activate(findControllers()));
      case 'SYNC_DEACTIVATE':
        this.deactivate(false);
        return Promise.resolve({ success: true });
      case 'SYNC_GET_POSITION': return Promise.resolve(this.agent?.getPosition() ?? null);
      default:
        if (!isSyncCommand(message)) return null;
        return this.agent ? runSyncCommand(this.agent, message) : Promise.resolve({ success: false });
    }
  }

  deactivate(notifyCoordinator: boolean): void {
    if (!this.agent) return;
    this.agent.destroy();
    this.agent = null;
    this.stopKeepAlive();
    if (notifyCoordinator) sendToBackground({ type: 'STOP_SYNC' }).catch(() => {});
  }

  private activate(controllers: VideoController[]): Replies['SYNC_ACTIVATE'] {
    this.deactivate(false);
    const controller = primaryMedia(controllers.filter(({ media }) => media.isConnected && media.readyState >= HTMLMediaElement.HAVE_METADATA));
    if (!controller) return { success: false, error: 'This tab has no media.' };
    this.agent = new SyncAgent(controller, event => { sendToBackground({ type: 'SYNC_EVENT', payload: event }).catch(() => {}); });
    this.startKeepAlive();
    // Report the user's chosen speed: the media may be mid drift correction.
    return { success: true, ...this.agent.getPosition(), playbackRate: controller.intendedSpeed };
  }

  private startKeepAlive(): void {
    this.openPort();
    this.timers = [
      setInterval(() => this.openPort(), KEEPALIVE_RECONNECT_MS),
      setInterval(() => {
        try { this.port?.postMessage({ type: 'PING' }); } catch { this.port = null; }
      }, KEEPALIVE_PING_MS),
    ];
  }

  private openPort(): void {
    this.port?.disconnect();
    try {
      const port = browser.runtime.connect({ name: KEEPALIVE_PORT });
      // Let the next rotation reconnect; immediate retries can loop during unload.
      port.onDisconnect.addListener(() => { if (this.port === port) this.port = null; });
      this.port = port;
    } catch {
      this.port = null;
    }
  }

  private stopKeepAlive(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.port?.disconnect();
    this.port = null;
  }
}
