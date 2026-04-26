import { safeMedia } from './safe-media';
import type { SyncEventPayload, SyncPositionResponse } from './sync-types';
import { SYNC } from './sync-types';

type EventCallback = (event: SyncEventPayload) => void;

export class SyncAgent {
  private media: HTMLMediaElement;
  private sendEvent: EventCallback;
  /** Applies a coordinator-issued rate to the local controller (so enforcement state stays consistent). */
  private setIntendedSpeed: (rate: number) => void;
  private pendingPause = 0;
  private pendingPlay = 0;
  private pendingSeek = 0;
  private pendingRate = 0;
  private coordinatorPlaying = false;
  private seeking = false;
  private destroyed = false;
  private seekDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private rateCorrectionTimer: ReturnType<typeof setTimeout> | null = null;
  private rateCorrectionBaseRate: number = 1.0;

  // Bound listeners for cleanup
  private onPause: () => void;
  private onPlay: () => void;
  private onSeeking: () => void;
  private onSeeked: () => void;
  private onWaiting: () => void;
  private onStalled: () => void;
  private onPlaying: () => void;

  constructor(
    media: HTMLMediaElement,
    sendEvent: EventCallback,
    baseRate: number = 1.0,
    setIntendedSpeed: (rate: number) => void = (rate) => safeMedia.setPlaybackRate(media, rate),
  ) {
    this.media = media;
    this.sendEvent = sendEvent;
    this.setIntendedSpeed = setIntendedSpeed;
    this.rateCorrectionBaseRate = baseRate;

    this.onPause = this.handlePause.bind(this);
    this.onPlay = this.handlePlay.bind(this);
    this.onSeeking = () => { this.seeking = true; };
    this.onSeeked = this.handleSeeked.bind(this);
    this.onWaiting = this.handleWaiting.bind(this);
    this.onStalled = this.handleStalled.bind(this);
    this.onPlaying = this.handlePlaying.bind(this);

    media.addEventListener('pause', this.onPause);
    media.addEventListener('play', this.onPlay);
    media.addEventListener('seeking', this.onSeeking);
    media.addEventListener('seeked', this.onSeeked);
    media.addEventListener('waiting', this.onWaiting);
    media.addEventListener('stalled', this.onStalled);
    media.addEventListener('playing', this.onPlaying);
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
    this.coordinatorPlaying = false;
    if (this.pendingPause > 0) {
      this.pendingPause--;
      return;
    }
    this.emit('pause');
  }

  private handlePlay(): void {
    if (this.pendingPlay > 0) {
      this.pendingPlay--;
      return;
    }
    this.emit('play');
  }

  private handleSeeked(): void {
    this.seeking = false;
    if (this.pendingSeek > 0) {
      this.pendingSeek--;
      return;
    }
    // Debounce rapid seeks (scrubbing)
    if (this.seekDebounceTimer) clearTimeout(this.seekDebounceTimer);
    this.seekDebounceTimer = setTimeout(() => {
      this.seekDebounceTimer = null;
      this.emit('seek');
    }, SYNC.SEEK_DEBOUNCE_MS);
  }

  private handleWaiting(): void {
    if (this.coordinatorPlaying || this.seeking) return;
    this.emit('buffering_start');
  }

  private handleStalled(): void {
    if (this.coordinatorPlaying || this.seeking) return;
    this.emit('buffering_start');
  }

  private handlePlaying(): void {
    if (this.coordinatorPlaying) {
      this.coordinatorPlaying = false;
      return;
    }
    this.emit('buffering_end');
  }

  // --- Commands from coordinator ---

  executePause(): void {
    this.coordinatorPlaying = false;
    if (!this.media.paused) {
      this.pendingPause++;
    }
    safeMedia.pause(this.media);
  }

  executePlay(): void {
    if (this.media.paused) {
      this.pendingPlay++;
      this.coordinatorPlaying = true;
    }
    safeMedia.play(this.media).catch(() => {
      // play() can reject (e.g., autoplay policy). Decrement counters so they
      // don't permanently suppress future user-initiated events.
      this.coordinatorPlaying = false;
      if (this.pendingPlay > 0) this.pendingPlay--;
    });
  }

  executeSeek(position: number): void {
    // Cancel any in-flight rate correction — its original target is now stale
    // once the position changes, and leaving it running would smear the seek.
    if (this.rateCorrectionTimer) {
      clearTimeout(this.rateCorrectionTimer);
      this.rateCorrectionTimer = null;
      safeMedia.setPlaybackRate(this.media, this.rateCorrectionBaseRate);
    }
    this.pendingSeek++;
    safeMedia.setCurrentTime(this.media, position);
  }

  /** Apply a coordinator-issued playback rate change. Echo-suppressed via pendingRate. */
  executeRateChange(rate: number): void {
    if (this.destroyed) return;
    if (this.rateCorrectionTimer) {
      clearTimeout(this.rateCorrectionTimer);
      this.rateCorrectionTimer = null;
    }
    this.rateCorrectionBaseRate = rate;
    if (Math.abs(safeMedia.getPlaybackRate(this.media) - rate) > 1e-3) {
      this.pendingRate++;
      this.setIntendedSpeed(rate);
    }
  }

  /**
   * Notify this agent that the user (via controller) just changed the intended speed.
   * Updates the rate-correction base and emits a ratechange event to the coordinator.
   * Coordinator-issued rate changes (executeRateChange) should NOT call this — they
   * call setIntendedSpeed directly and pendingRate suppresses the echo.
   */
  notifyIntendedSpeedChange(rate: number): void {
    if (this.destroyed) return;
    if (this.pendingRate > 0) {
      this.pendingRate--;
      return;
    }
    this.rateCorrectionBaseRate = rate;
    this.sendEvent({
      action: 'ratechange',
      position: safeMedia.getCurrentTime(this.media),
      timestamp: Date.now(),
      rate,
    });
  }

  /** Apply temporary rate adjustment for small drift corrections */
  applyRateCorrection(rateFactor: number, durationMs: number): void {
    if (this.rateCorrectionTimer) {
      clearTimeout(this.rateCorrectionTimer);
    }
    // rateCorrectionBaseRate is updated by notifyIntendedSpeedChange / executeRateChange
    // so this stays accurate even when the user changes speed mid-session.
    safeMedia.setPlaybackRate(this.media, this.rateCorrectionBaseRate + rateFactor);
    this.rateCorrectionTimer = setTimeout(() => {
      this.rateCorrectionTimer = null;
      if (!this.destroyed) {
        safeMedia.setPlaybackRate(this.media, this.rateCorrectionBaseRate);
      }
    }, durationMs);
  }

  getPosition(): SyncPositionResponse {
    return {
      currentTime: safeMedia.getCurrentTime(this.media),
      paused: this.media.paused,
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
      safeMedia.setPlaybackRate(this.media, this.rateCorrectionBaseRate);
    }
    this.media.removeEventListener('pause', this.onPause);
    this.media.removeEventListener('play', this.onPlay);
    this.media.removeEventListener('seeking', this.onSeeking);
    this.media.removeEventListener('seeked', this.onSeeked);
    this.media.removeEventListener('waiting', this.onWaiting);
    this.media.removeEventListener('stalled', this.onStalled);
    this.media.removeEventListener('playing', this.onPlaying);
  }
}
