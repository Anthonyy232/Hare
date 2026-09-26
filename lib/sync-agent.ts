import { safeMedia } from './safe-media';
import type { SyncEventPayload, SyncPositionResponse } from './sync-types';
import { SYNC } from './sync-types';

type EventCallback = (event: SyncEventPayload) => void;

export class SyncAgent {
  private media: HTMLMediaElement;
  private sendEvent: EventCallback;
  /** Applies a coordinator-issued rate to the local controller (so enforcement state stays consistent). */
  private setIntendedSpeed: (rate: number) => void;
  /** Applies a temporary correction rate without changing the user's intended speed. */
  private setTransientRate: (rate: number) => void;
  private pendingPause = 0;
  private pendingPlay = 0;
  private pendingSeekPosition: number | null = null;
  private playRevision = 0;
  private applyingRemoteRate = false;
  private buffering: boolean;
  private destroyed = false;
  private seekDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private rateCorrectionTimer: ReturnType<typeof setTimeout> | null = null;
  private rateCorrectionBaseRate: number = 1.0;

  private listeners = new AbortController();

  constructor(
    media: HTMLMediaElement,
    sendEvent: EventCallback,
    baseRate: number = 1.0,
    setIntendedSpeed: (rate: number) => void = (rate) => safeMedia.setPlaybackRate(media, rate),
    setTransientRate: (rate: number) => void = (rate) => safeMedia.setPlaybackRate(media, rate),
  ) {
    this.media = media;
    this.sendEvent = sendEvent;
    this.setIntendedSpeed = setIntendedSpeed;
    this.setTransientRate = setTransientRate;
    this.rateCorrectionBaseRate = baseRate;
    this.buffering = !media.paused && media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;

    const { signal } = this.listeners;
    media.addEventListener('pause', this.handlePause.bind(this), { signal });
    media.addEventListener('play', this.handlePlay.bind(this), { signal });
    media.addEventListener('seeked', this.handleSeeked.bind(this), { signal });
    media.addEventListener('waiting', this.handleWaiting.bind(this), { signal });
    media.addEventListener('stalled', this.handleStalled.bind(this), { signal });
    media.addEventListener('playing', this.handleReady.bind(this), { signal });
    media.addEventListener('canplay', this.handleReady.bind(this), { signal });
  }

  private emit(action: Exclude<SyncEventPayload['action'], 'ratechange'>): void {
    if (this.destroyed) return;
    this.sendEvent({
      action,
      position: safeMedia.getCurrentTime(this.media),
      timestamp: Date.now(),
      rate: safeMedia.getPlaybackRate(this.media),
    });
  }

  private handlePause(): void {
    if (this.pendingPause > 0) {
      this.pendingPause--;
      return;
    }
    this.playRevision++;
    this.buffering = false;
    this.emit('pause');
  }

  private handlePlay(): void {
    if (this.pendingPlay > 0) {
      this.pendingPlay--;
      return;
    }
    this.playRevision++;
    this.emit('play');
  }

  private handleSeeked(): void {
    const remoteSeek = this.pendingSeekPosition !== null
      && Math.abs(safeMedia.getCurrentTime(this.media) - this.pendingSeekPosition) < SYNC.DRIFT_IGNORE_THRESHOLD_MS / 1000;
    this.pendingSeekPosition = null;
    if (remoteSeek) return;
    if (this.seekDebounceTimer) clearTimeout(this.seekDebounceTimer);
    this.seekDebounceTimer = setTimeout(() => {
      this.seekDebounceTimer = null;
      this.emit('seek');
    }, SYNC.SEEK_DEBOUNCE_MS);
  }

  private handleWaiting(): void {
    if (this.media.paused || this.buffering) return;
    this.buffering = true;
    this.emit('buffering_start');
  }

  private handleStalled(): void {
    if (this.media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) this.handleWaiting();
  }

  private handleReady(): void {
    if (!this.buffering) return;
    this.buffering = false;
    this.emit('buffering_end');
  }

  executePause(buffering = false): void {
    this.playRevision++;
    if (!buffering) this.buffering = false;
    if (!this.media.paused) {
      this.pendingPause++;
    }
    safeMedia.pause(this.media);
  }

  async executePlay(): Promise<boolean> {
    if (this.destroyed) return false;
    const revision = ++this.playRevision;
    if (this.media.paused) {
      this.pendingPlay++;
    }
    try {
      await safeMedia.play(this.media);
      return !this.destroyed && revision === this.playRevision;
    } catch {
      // A rejected play must not suppress later user events.
      if (this.destroyed || revision !== this.playRevision) return false;
      this.buffering = false;
      if (this.pendingPlay > 0) this.pendingPlay--;
      this.emit('pause');
      return false;
    }
  }

  executeSeek(position: number): void {
    if (this.destroyed || !Number.isFinite(position)) return;
    if (this.seekDebounceTimer) {
      clearTimeout(this.seekDebounceTimer);
      this.seekDebounceTimer = null;
    }
    // A seek invalidates the current drift correction.
    if (this.rateCorrectionTimer) {
      clearTimeout(this.rateCorrectionTimer);
      this.rateCorrectionTimer = null;
      this.setTransientRate(this.rateCorrectionBaseRate);
    }
    const before = safeMedia.getCurrentTime(this.media);
    safeMedia.setCurrentTime(this.media, position);
    const after = safeMedia.getCurrentTime(this.media);
    // Browsers can coalesce multiple seeks into one seeked event.
    this.pendingSeekPosition = this.media.seeking || Math.abs(after - before) > 1e-3 ? after : null;
  }

  /** Apply a coordinator-issued rate while suppressing the synchronous controller callback. */
  executeRateChange(rate: number): void {
    if (this.destroyed || !Number.isFinite(rate) || rate <= 0) return;
    if (this.rateCorrectionTimer) {
      clearTimeout(this.rateCorrectionTimer);
      this.rateCorrectionTimer = null;
    }
    this.rateCorrectionBaseRate = rate;
    this.applyingRemoteRate = true;
    try { this.setIntendedSpeed(rate); }
    finally { this.applyingRemoteRate = false; }
  }

  // Propagate local speed changes; suppress synchronous echoes from remote changes.
  notifyIntendedSpeedChange(rate: number): void {
    if (this.destroyed) return;
    if (this.applyingRemoteRate) return;
    if (this.rateCorrectionTimer) clearTimeout(this.rateCorrectionTimer);
    this.rateCorrectionTimer = null;
    this.rateCorrectionBaseRate = rate;
    this.sendEvent({
      action: 'ratechange',
      position: safeMedia.getCurrentTime(this.media),
      timestamp: Date.now(),
      rate,
    });
  }

  applyRateCorrection(rateFactor: number, durationMs: number): void {
    if (this.destroyed || !Number.isFinite(rateFactor) || !Number.isFinite(durationMs) || durationMs < 0) return;
    if (this.rateCorrectionTimer) {
      clearTimeout(this.rateCorrectionTimer);
    }
    this.setTransientRate(this.rateCorrectionBaseRate + rateFactor);
    this.rateCorrectionTimer = setTimeout(() => {
      this.rateCorrectionTimer = null;
      if (!this.destroyed) {
        this.setTransientRate(this.rateCorrectionBaseRate);
      }
    }, durationMs);
  }

  getPosition(): SyncPositionResponse {
    return {
      currentTime: safeMedia.getCurrentTime(this.media),
      paused: this.media.paused,
      buffering: this.buffering,
      playbackRate: safeMedia.getPlaybackRate(this.media),
      timestamp: Date.now(),
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.seekDebounceTimer) {
      clearTimeout(this.seekDebounceTimer);
      this.seekDebounceTimer = null;
    }
    if (this.rateCorrectionTimer) {
      clearTimeout(this.rateCorrectionTimer);
      this.rateCorrectionTimer = null;
      this.setTransientRate(this.rateCorrectionBaseRate);
    }
    this.listeners.abort();
  }

  isForMedia(media: HTMLMediaElement): boolean {
    return this.media === media;
  }
}
