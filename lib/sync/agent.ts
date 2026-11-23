import { safeMedia } from '../media/safe-media';
import { clampRate, clampSpeed, sameSpeed } from '../speed';
import type { SeekTarget, SyncPlayer } from './commands';
import { RateCorrection } from './rate-correction';
import { IN_SYNC_SECONDS, type SyncEventPayload, type SyncPositionResponse } from './types';

const SEEK_DEBOUNCE_MS = 50;

/** What sync needs from the controller of the media it syncs. */
export interface SyncedController {
  readonly media: HTMLMediaElement;
  /** The speed the user chose, without any rate correction. */
  readonly intendedSpeed: number;
  setSpeed(speed: number): void;
  applyTransientRate(rate: number): void;
  setIntendedSpeedListener(listener: ((speed: number) => void) | null): void;
}

/** Reports a tab's media events to sync and carries out the commands sync sends back. */
export class SyncAgent implements SyncPlayer {
  readonly media: HTMLMediaElement;
  private pendingPause = 0;
  private pendingPlay = 0;
  private pendingSeekPosition: number | null = null;
  private playRevision = 0;
  private buffering: boolean;
  private destroyed = false;
  private seekDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly correction: RateCorrection;
  private readonly listeners = new AbortController();

  constructor(
    private readonly controller: SyncedController,
    private readonly sendEvent: (event: SyncEventPayload) => void,
  ) {
    this.media = controller.media;
    const media = this.media;
    this.correction = new RateCorrection(controller.intendedSpeed, rate => controller.applyTransientRate(rate));
    this.buffering = !media.paused && media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
    controller.setIntendedSpeedListener(rate => this.handleIntendedSpeed(rate));

    const { signal } = this.listeners;
    media.addEventListener('pause', this.handlePause.bind(this), { signal });
    media.addEventListener('play', this.handlePlay.bind(this), { signal });
    media.addEventListener('seeked', this.handleSeeked.bind(this), { signal });
    media.addEventListener('waiting', this.handleWaiting.bind(this), { signal });
    media.addEventListener('stalled', this.handleStalled.bind(this), { signal });
    media.addEventListener('playing', this.handleReady.bind(this), { signal });
    media.addEventListener('canplay', this.handleReady.bind(this), { signal });
  }

  private emit(action: SyncEventPayload['action'], rate = safeMedia.getPlaybackRate(this.media)): void {
    if (this.destroyed) return;
    this.sendEvent({ action, position: safeMedia.getCurrentTime(this.media), timestamp: Date.now(), rate });
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
    // A seek within buffered data never drops readyState, so 'canplay' won't follow.
    if (this.media.paused && this.media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) this.handleReady();
    const remoteSeek =
      this.pendingSeekPosition !== null &&
      Math.abs(safeMedia.getCurrentTime(this.media) - this.pendingSeekPosition) < IN_SYNC_SECONDS;
    this.pendingSeekPosition = null;
    if (remoteSeek) return;
    if (this.seekDebounceTimer) clearTimeout(this.seekDebounceTimer);
    this.seekDebounceTimer = setTimeout(() => {
      this.seekDebounceTimer = null;
      this.emit('seek');
    }, SEEK_DEBOUNCE_MS);
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

  /** The user chose a new speed here; a speed sync just applied comes back equal to the base and isn't echoed. */
  private handleIntendedSpeed(rate: number): void {
    if (sameSpeed(rate, this.correction.base)) return;
    this.correction.setBase(rate);
    this.emit('ratechange', rate);
  }

  pause(seek: SeekTarget | undefined, buffering: boolean): void {
    if (seek) this.seek(seek);
    this.playRevision++;
    if (!buffering) this.buffering = false;
    if (!this.media.paused) {
      this.pendingPause++;
    }
    safeMedia.pause(this.media);
    // Paused media never fires 'waiting', so report a peer-requested seek into unloaded media as buffering until it lands.
    if (buffering && this.media.seeking && !this.buffering && !this.isBuffered(this.media.currentTime)) {
      this.buffering = true;
      this.emit('buffering_start');
    }
  }

  private isBuffered(time: number): boolean {
    const { buffered } = this.media;
    for (let i = 0; i < buffered.length; i++) {
      if (time >= buffered.start(i) && time < buffered.end(i)) return true;
    }
    return false;
  }

  async play(seek?: SeekTarget): Promise<boolean> {
    if (seek) this.seek(seek);
    const revision = ++this.playRevision;
    if (this.media.paused) {
      this.pendingPlay++;
    }
    try {
      await safeMedia.play(this.media);
      return !this.destroyed && revision === this.playRevision;
    } catch {
      if (this.destroyed || revision !== this.playRevision) return false;
      this.buffering = false;
      if (this.pendingPlay > 0) this.pendingPlay--;
      this.emit('pause');
      return false;
    }
  }

  seek({ position, tolerance }: SeekTarget): void {
    const before = safeMedia.getCurrentTime(this.media);
    if (!Number.isFinite(position) || Math.abs(before - position) <= tolerance) return;
    if (this.seekDebounceTimer) {
      clearTimeout(this.seekDebounceTimer);
      this.seekDebounceTimer = null;
    }
    this.correction.restore();
    safeMedia.setCurrentTime(this.media, position);
    const after = safeMedia.getCurrentTime(this.media);
    // Browsers can coalesce multiple seeks into one seeked event.
    this.pendingSeekPosition = this.media.seeking || Math.abs(after - before) > 1e-3 ? after : null;
  }

  /** Fails for a rate outside what browsers play, such as mpv above 16x. */
  setRate(rate: number): boolean {
    if (!Number.isFinite(rate) || rate <= 0) return false;
    // Based on the controller's rounding, so its report of the new speed isn't taken for a user change.
    const speed = clampSpeed(rate);
    this.correction.setBase(speed);
    this.controller.setSpeed(speed);
    return clampRate(rate) === rate && sameSpeed(safeMedia.getPlaybackRate(this.media), speed);
  }

  correctRate(rateFactor: number, durationMs: number): void {
    this.correction.apply(rateFactor, durationMs);
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
    this.correction.restore();
    this.controller.setIntendedSpeedListener(null);
    this.listeners.abort();
  }
}
