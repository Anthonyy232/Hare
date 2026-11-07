import { VideoController } from './controller';
import { ObserverPool } from './observer-pool';
import { CLEANUP } from './constants';
import type { Settings, SiteHandler } from './types';

type MediaEntry = { listeners: AbortController; controller?: VideoController };

export class MediaRegistry {
  private readonly entries = new Map<HTMLMediaElement, MediaEntry>();
  private observer: ObserverPool;
  private readonly cleanupInterval: ReturnType<typeof setInterval>;
  private destroyed = false;

  constructor(
    private settings: Settings,
    private readonly siteHandler: SiteHandler,
    private readonly onSourceInvalidated: (media: HTMLMediaElement) => void,
  ) {
    this.observer = this.createObserver();
    this.observer.observe(document);
    this.cleanupInterval = setInterval(() => {
      for (const media of this.entries.keys()) {
        if (!media.isConnected) this.remove(media);
      }
    }, CLEANUP.STALE_CHECK_INTERVAL_MS);
  }

  connectedControllers(): VideoController[] {
    return [...this.entries.values()].flatMap(({ controller }) =>
      controller?.media.isConnected ? [controller] : []);
  }

  rescan(): void {
    if (!this.destroyed) this.observer.rescan(document);
  }

  updateSettings(settings: Settings): void {
    if (this.destroyed) return;
    const audioChanged = this.settings.enableAudio !== settings.enableAudio;
    this.settings = settings;
    if (audioChanged) {
      this.observer.disconnect();
      for (const media of this.entries.keys()) {
        if (media instanceof HTMLAudioElement && !settings.enableAudio) this.remove(media);
      }
      this.observer = this.createObserver();
      this.observer.observe(document);
    }
    for (const { controller } of this.entries.values()) controller?.updateSettings(settings);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.cleanupInterval);
    this.observer.disconnect();
    for (const media of this.entries.keys()) this.remove(media);
  }

  private createObserver(): ObserverPool {
    return new ObserverPool(media => this.consider(media), media => this.remove(media), this.settings.enableAudio);
  }

  private consider(media: HTMLMediaElement): void {
    if (this.destroyed || !media.isConnected || this.entries.get(media)?.controller) return;
    if (media instanceof HTMLAudioElement && !this.settings.enableAudio) return;
    if (media instanceof HTMLVideoElement && this.siteHandler.shouldIgnoreVideo(media)) {
      // Late-loading players may qualify once they have dimensions or start playing.
      if (!this.entries.has(media)) {
        const listeners = new AbortController();
        this.entries.set(media, { listeners });
        for (const type of ['loadedmetadata', 'resize', 'play', 'canplay']) {
          media.addEventListener(type, () => this.consider(media), { signal: listeners.signal });
        }
      }
      return;
    }
    this.entries.get(media)?.listeners.abort();
    const listeners = new AbortController();
    const controller = new VideoController(media, this.settings, this.siteHandler);
    this.entries.set(media, { listeners, controller });
    for (const type of ['loadstart', 'emptied', 'error']) {
      media.addEventListener(type, () => {
        this.onSourceInvalidated(media);
        if (!media.isConnected) this.remove(media);
        else controller.updateSpeedDisplay();
      }, { signal: listeners.signal });
    }
  }

  private remove(media: HTMLMediaElement): void {
    const entry = this.entries.get(media);
    if (!entry) return;
    this.onSourceInvalidated(media);
    entry.controller?.destroy();
    entry.listeners.abort();
    this.entries.delete(media);
  }
}
