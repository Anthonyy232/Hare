import { logger } from './logger';
import { SYNC, MPV_TAB_ID } from './sync-types';
import type { SyncCandidate, SyncEventPayload, SyncPositionResponse } from './sync-types';
import type { HareMessage } from './messages';

const SERVER = 'http://127.0.0.1:42730';

interface MpvState { file: string; time: number; paused: boolean; buffering: boolean; speed: number; title: string }
interface MpvEvents {
  file: string | null;
  seq: number;
  events: Array<{ action: SyncEventPayload['action']; position: number; rate: number }>;
}

/** mpv's side of a sync pair, served by public/hare.lua running inside mpv. */
class MpvClient {
  onEvent: (event: SyncEventPayload) => void = () => {};
  onFileChanged: () => void = () => {};
  title = 'mpv';
  private file: string | null = null;
  private baseSpeed: number | null = null;
  private listener: AbortController | null = null;
  private correctionTimer: ReturnType<typeof setTimeout> | undefined;

  async candidate(): Promise<SyncCandidate | null> {
    try {
      const state = await this.request<MpvState>('/state', 500);
      return { tabId: MPV_TAB_ID, title: state.title, domain: 'mpv', videoCount: 1 };
    } catch {
      return null;
    }
  }

  async handle(message: HareMessage): Promise<unknown> {
    switch (message.type) {
      case 'SYNC_ACTIVATE': {
        try { await this.restoreCorrection(); } finally { this.stop(); }
        const position = await this.state();
        this.listen();
        return { success: true, ...position };
      }
      case 'SYNC_DEACTIVATE':
        try { await this.restoreCorrection(); } finally { this.stop(); }
        return { success: true };
      case 'SYNC_GET_POSITION':
        // Restarts the event stream after the background worker restarts.
        this.listen();
        return this.state();
      case 'SYNC_PAUSE': {
        const { position } = message.payload;
        if (position >= 0) await this.restoreCorrection();
        return this.set({ pause: 1, seek: position >= 0 ? position : undefined });
      }
      case 'SYNC_PLAY': {
        const { position, rate, timestamp } = message.payload;
        if (position >= 0) await this.restoreCorrection();
        const seek = position >= 0 ? position + (rate ?? this.baseSpeed ?? 1) * (Date.now() - timestamp) / 1000 : undefined;
        return this.set({ pause: 0, seek });
      }
      case 'SYNC_SEEK':
        await this.restoreCorrection();
        return this.set({ seek: message.payload.position });
      case 'SYNC_RATE': {
        const { rate } = message.payload;
        if (rate == null) return { success: false };
        clearTimeout(this.correctionTimer);
        this.correctionTimer = undefined;
        this.baseSpeed = rate;
        return this.set({ speed: rate });
      }
      case 'SYNC_DRIFT_CORRECT': {
        const drift = message.payload;
        if (drift.method === 'seek') {
          await this.restoreCorrection();
          return this.set({ seek: drift.position });
        }
        const base = this.baseSpeed ?? 1;
        clearTimeout(this.correctionTimer);
        this.correctionTimer = setTimeout(() => {
          this.correctionTimer = undefined;
          this.set({ speed: base }).catch(error => logger.debug('Could not restore mpv speed:', error));
        }, drift.durationMs);
        return this.set({ speed: base + drift.rateFactor });
      }
      default:
        return { success: false, error: `mpv can't handle ${message.type}.` };
    }
  }

  private async request<T>(path: string, timeoutMs: number = SYNC.POSITION_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
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
    this.title = state.title;
    this.baseSpeed ??= state.speed;
    return {
      currentTime: state.time,
      paused: state.paused,
      buffering: state.buffering,
      playbackRate: state.speed,
      timestamp: (sent + Date.now()) / 2,
    };
  }

  private async set(changes: Record<string, number | undefined>): Promise<{ success: true }> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(changes)) if (value !== undefined) query.set(key, String(value));
    await this.state(`/set?${query}`);
    return { success: true };
  }

  private checkFile(file: string | null): void {
    if (this.file === null) this.file = file;
    else if (file !== this.file) {
      this.stop();
      this.onFileChanged();
      throw new Error('mpv opened another file.');
    }
  }

  private listen(): void {
    if (this.listener) return;
    const listener = this.listener = new AbortController();
    void (async () => {
      let after = -1; // The first reply only reports where mpv's event list is.
      while (!listener.signal.aborted) {
        try {
          const reply = await this.request<MpvEvents>(`/events?after=${after}`, 30_000, listener.signal);
          const received = Date.now();
          this.checkFile(reply.file);
          if (after >= 0) {
            for (const { action, position, rate } of reply.events) {
              if (action === 'ratechange') {
                clearTimeout(this.correctionTimer);
                this.correctionTimer = undefined;
                this.baseSpeed = rate;
              }
              this.onEvent({ action, position, rate, timestamp: received });
            }
          }
          after = reply.seq;
        } catch (error) {
          if (listener.signal.aborted) break;
          logger.debug('mpv event request failed:', error);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    })();
  }

  private async restoreCorrection(): Promise<void> {
    if (this.correctionTimer === undefined) return;
    clearTimeout(this.correctionTimer);
    this.correctionTimer = undefined;
    if (this.baseSpeed !== null) await this.set({ speed: this.baseSpeed });
  }

  private stop(): void {
    this.listener?.abort();
    this.listener = null;
    this.file = null;
    this.baseSpeed = null;
    clearTimeout(this.correctionTimer);
    this.correctionTimer = undefined;
  }
}

export const mpv = new MpvClient();
