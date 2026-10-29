import { browser, type Browser } from 'wxt/browser';
import type { VideoController } from './controller';
import type { HareMessage, Reply } from './types';
import { SyncAgent } from './sync-agent';
import { SYNC } from './sync-types';
import { sendToBackground } from './messaging';
import { primaryMedia } from './media-detector';

type SyncCommand = Extract<HareMessage, { type: 'SYNC_PAUSE' | 'SYNC_PLAY' | 'SYNC_SEEK' | 'SYNC_RATE' | 'SYNC_DRIFT_CORRECT' }>;

const DRIFT_IGNORE_S = SYNC.DRIFT_IGNORE_THRESHOLD_MS / 1000;

/** This frame's side of a sync pair: one player's agent, plus a port that keeps the background worker alive. */
export class SyncEndpoint {
  private agent: SyncAgent | null = null;
  private controller: VideoController | null = null;
  private port: Browser.runtime.Port | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];

  isFor(media: HTMLMediaElement): boolean {
    return this.controller?.media === media;
  }

  activate(controllers: VideoController[]): Reply<{ type: 'SYNC_ACTIVATE' }> {
    this.deactivate(false);
    const controller = primaryMedia(controllers.filter(({ media }) => media.isConnected && media.readyState >= HTMLMediaElement.HAVE_METADATA));
    if (!controller) return { success: false, error: 'No video found' };

    const baseRate = controller.intendedSpeed;
    const agent = new SyncAgent(
      controller.media,
      event => { sendToBackground({ type: 'SYNC_EVENT', payload: event }).catch(() => {}); },
      baseRate,
      // Route remote rates through the controller so its enforcement stays consistent.
      rate => controller.setSpeed(rate),
      rate => controller.applyTransientRate(rate),
    );
    controller.setIntendedSpeedListener(rate => agent.notifyIntendedSpeedChange(rate));
    this.agent = agent;
    this.controller = controller;
    this.startKeepAlive();
    return { success: true, ...agent.getPosition(), playbackRate: baseRate };
  }

  deactivate(notifyCoordinator: boolean): void {
    if (!this.agent) return;
    this.agent.destroy();
    this.agent = null;
    this.controller?.setIntendedSpeedListener(null);
    this.controller = null;
    this.stopKeepAlive();
    if (notifyCoordinator) sendToBackground({ type: 'STOP_SYNC' }).catch(() => {});
  }

  getPosition(): Reply<{ type: 'SYNC_GET_POSITION' }> {
    return this.agent?.getPosition() ?? null;
  }

  async execute(message: SyncCommand): Promise<Reply<SyncCommand>> {
    const agent = this.agent;
    if (!agent) return { success: false };
    switch (message.type) {
      case 'SYNC_PAUSE': {
        const { position, buffering } = message.payload;
        // Do not extrapolate a paused source; skip tiny seeks to avoid visible jitter.
        if (position >= 0 && Math.abs(agent.getPosition().currentTime - position) > DRIFT_IGNORE_S) agent.executeSeek(position);
        agent.executePause(buffering === true);
        return { success: true };
      }
      case 'SYNC_PLAY': {
        const { position, rate, timestamp } = message.payload;
        if (position >= 0) {
          const target = position + (rate ?? agent.getPosition().playbackRate) * (Date.now() - timestamp) / 1000;
          if (Math.abs(agent.getPosition().currentTime - target) > DRIFT_IGNORE_S) agent.executeSeek(target);
        }
        return { success: await agent.executePlay() };
      }
      case 'SYNC_SEEK': {
        // A peer's buffering pause has usually already moved this player there.
        const { position } = message.payload;
        if (Math.abs(agent.getPosition().currentTime - position) > DRIFT_IGNORE_S) agent.executeSeek(position);
        return { success: true };
      }
      case 'SYNC_RATE': {
        const { rate } = message.payload;
        if (rate == null) return { success: false };
        agent.executeRateChange(rate);
        return { success: Math.abs(agent.getPosition().playbackRate - rate) < 0.001 };
      }
      case 'SYNC_DRIFT_CORRECT': {
        const drift = message.payload;
        if (drift.method === 'seek') agent.executeSeek(drift.position);
        else agent.applyRateCorrection(drift.rateFactor, drift.durationMs);
        return { success: true };
      }
    }
  }

  private startKeepAlive(): void {
    this.openPort();
    this.timers = [
      setInterval(() => this.openPort(), SYNC.KEEPALIVE_RECONNECT_MS),
      setInterval(() => {
        try { this.port?.postMessage({ type: 'PING' }); } catch { this.port = null; }
      }, SYNC.KEEPALIVE_PING_MS),
    ];
  }

  private openPort(): void {
    this.port?.disconnect();
    try {
      const port = browser.runtime.connect({ name: 'sync-keepalive' });
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
