/** mpv takes part in sync as if it were a tab with this id. */
export const MPV_TAB_ID = -1;

/** Positions this close are in sync; seeking to fix less would only stutter. */
export const IN_SYNC_SECONDS = 0.05;

export const NUDGE_STEPS: readonly number[] = [0.01, 0.05, 0.1, 0.5];

/** Content scripts hold a port with this name open so the background worker stays alive during sync. */
export const KEEPALIVE_PORT = 'sync-keepalive';

export interface SyncedEndpoint {
  tabId: number;
  frameId: number;
  title: string;
}

export interface SyncSession {
  videoA: SyncedEndpoint;
  videoB: SyncedEndpoint;
  /** Seconds: videoB position = videoA position + offset. */
  offset: number;
  nudgeStep: number;
  /** Bumped on each user action so drift corrections measured before it are dropped. */
  generation: number;
  /** Which side is waiting for data; both resume once neither is. */
  bufferingSide: 'A' | 'B' | 'both' | null;
}

export interface SyncCandidate {
  tabId: number;
  title: string;
  domain: string;
  favIconUrl?: string;
  videoCount: number;
}

export interface SyncEventPayload {
  action: 'pause' | 'play' | 'seek' | 'buffering_start' | 'buffering_end' | 'ratechange';
  /** The source's currentTime when the event happened. */
  position: number;
  /** Date.now() when the event happened. */
  timestamp: number;
  rate: number;
}

/** Where the other player was, so the receiver can account for the time the message took to arrive. */
interface PlaybackPoint {
  position: number;
  rate: number;
  timestamp: number;
}

/** Without a position, pause and play leave the player where it is. */
export interface SyncPausePayload {
  position?: number;
  buffering?: boolean;
}
export interface SyncPlayPayload {
  from?: PlaybackPoint;
}
export interface SyncSeekPayload {
  position: number;
}
export interface SyncRatePayload {
  rate: number;
}

export type DriftCorrectPayload =
  | { method: 'seek'; position: number }
  // Gradual catch-up: play at baseRate + rateFactor for durationMs.
  | { method: 'rate'; rateFactor: number; durationMs: number };

export interface SyncPositionResponse {
  currentTime: number;
  paused: boolean;
  buffering: boolean;
  playbackRate: number;
  /** Date.now() when the position was read. */
  timestamp: number;
}

export type SyncStatusResponse =
  | { active: false }
  | {
      active: true;
      videoA: { title: string };
      videoB: { title: string };
      offset: number;
      nudgeStep: number;
    };

export function positionAt(position: number, rate: number, timestamp: number, now = Date.now()): number {
  return position + (rate * (now - timestamp)) / 1000;
}
