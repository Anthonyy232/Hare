import { logger } from '../logger';
import type { HareMessage } from '../messages';
import { isSyncCommand, runSyncCommand, type SeekTarget, type SyncPlayer } from './commands';
import { RateCorrection } from './rate-correction';
import { MPV_TAB_ID, type SyncCandidate, type SyncEventPayload, type SyncPositionResponse } from './types';

// Served by public/hare.lua running inside mpv.
const SERVER = 'http://127.0.0.1:42730';
const REQUEST_TIMEOUT_MS = 2000;
// Longer than hare.lua holds an /events request open when nothing happens (20 s).
const EVENTS_TIMEOUT_MS = 30_000;
const EVENTS_RETRY_MS = 1000;

interface MpvState {
  file: string;
  time: number;
  paused: boolean;
  buffering: boolean;
  speed: number;
  title: string;
}
interface MpvEvents {
  file: string | null;
  seq: number;
  events: Array<{ action: SyncEventPayload['action']; position: number; rate: number }>;
}

/** mpv's side of a sync pair. */
export class MpvClient implements SyncPlayer {
  private fileTitle = 'mpv';
  private file: string | null = null;
  private correction: RateCorrection | null = null;
  private listener: AbortController | null = null;

  constructor(
    private readonly callbacks: {
      onEvent: (event: SyncEventPayload) => void;
      onFileChanged: () => void;
    },
  ) {}

  async candidate(): Promise<SyncCandidate | null> {
    try {
      const state = await this.request<MpvState>('/state', 500);
      this.fileTitle = state.title;
      return { tabId: MPV_TAB_ID, title: state.title, domain: 'mpv', videoCount: 1 };
    } catch {
      return null;
    }
  }

  /** The title of the file mpv last reported. */
  get title(): string {
    return this.fileTitle;
  }

  async handle(message: HareMessage): Promise<unknown> {
    switch (message.type) {
      case 'SYNC_ACTIVATE': {
        try {
          await this.correction?.restore();
        } finally {
          this.stop();
        }
        const position = await this.state();
        this.listen();
        return { success: true, ...position };
      }
      case 'SYNC_DEACTIVATE':
        try {
          await this.correction?.restore();
        } finally {
          this.stop();
        }
        return { success: true };
      case 'SYNC_GET_POSITION':
        // Restarts the event stream after the background worker restarts.
        this.listen();
        return this.state();
      default:
        if (isSyncCommand(message)) return runSyncCommand(this, message);
        return { success: false, error: `mpv can't handle ${message.type}.` };
    }
  }

  async pause(seek: SeekTarget | undefined): Promise<void> {
    if (seek) await this.correction?.restore();
    await this.set({ pause: 1, ...this.seekQuery(seek) });
  }

  async play(seek: SeekTarget | undefined): Promise<boolean> {
    if (seek) await this.correction?.restore();
    await this.set({ pause: 0, ...this.seekQuery(seek) });
    return true;
  }

  async seek(target: SeekTarget): Promise<void> {
    await this.correction?.restore();
    await this.set(this.seekQuery(target));
  }

  async setRate(rate: number): Promise<boolean> {
    this.correction?.setBase(rate);
    await this.set({ speed: rate });
    return true;
  }

  async correctRate(rateFactor: number, durationMs: number): Promise<void> {
    await this.correction?.apply(rateFactor, durationMs);
  }

  private seekQuery(target: SeekTarget | undefined) {
    return target ? { seek: target.position, tolerance: target.tolerance } : {};
  }

  private async request<T>(path: string, timeoutMs = REQUEST_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(SERVER + path, {
      // The script rejects requests without this header, which web pages can't send to it.
      headers: { 'X-Hare': '1' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new Error(`mpv replied ${response.status}.`);
    return response.json();
  }

  private async state(path = '/state'): Promise<SyncPositionResponse> {
    const sent = Date.now();
    const state = await this.request<MpvState>(path);
    this.checkFile(state.file);
    this.fileTitle = state.title;
    this.correction ??= new RateCorrection(state.speed, speed => this.set({ speed }));
    return {
      currentTime: state.time,
      paused: state.paused,
      buffering: state.buffering,
      playbackRate: state.speed,
      // Assume mpv read its position halfway through the round trip.
      timestamp: (sent + Date.now()) / 2,
    };
  }

  private async set(changes: Record<string, number | undefined>): Promise<void> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(changes)) if (value !== undefined) query.set(key, String(value));
    await this.state(`/set?${query}`);
  }

  private checkFile(file: string | null): void {
    if (this.file === null) this.file = file;
    else if (file !== this.file) {
      this.stop();
      this.callbacks.onFileChanged();
      throw new Error('mpv opened another file.');
    }
  }

  private listen(): void {
    if (this.listener) return;
    const listener = new AbortController();
    this.listener = listener;
    void (async () => {
      let after = -1; // The first reply only reports where mpv's event list is.
      while (!listener.signal.aborted) {
        try {
          const reply = await this.request<MpvEvents>(`/events?after=${after}`, EVENTS_TIMEOUT_MS, listener.signal);
          const received = Date.now();
          this.checkFile(reply.file);
          if (after >= 0) {
            for (const { action, position, rate } of reply.events) {
              if (action === 'ratechange') this.correction?.setBase(rate);
              this.callbacks.onEvent({ action, position, rate, timestamp: received });
            }
          }
          after = reply.seq;
        } catch (error) {
          if (listener.signal.aborted) break;
          logger.debug('mpv event request failed:', error);
          await new Promise(resolve => setTimeout(resolve, EVENTS_RETRY_MS));
        }
      }
    })();
  }

  private stop(): void {
    this.listener?.abort();
    this.listener = null;
    this.file = null;
    this.correction?.cancel();
    this.correction = null;
  }
}
