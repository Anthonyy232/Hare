export interface SyncSession {
  videoA: { tabId: number; frameId?: number };
  videoB: { tabId: number; frameId?: number };
  offset: number; // seconds. videoB_position = videoA_position + offset
  nudgeStep: number;
  generation: number; // incremented on each user action, used to invalidate stale drift corrections
  bufferingTab: 'A' | 'B' | 'both' | null;
}

export interface SyncCandidate {
  tabId: number;
  title: string;
  domain: string;
  videoCount: number;
}

export interface SyncEventPayload {
  action: 'pause' | 'play' | 'seek' | 'buffering_start' | 'buffering_end' | 'ratechange';
  position: number; // absolute currentTime (ignored for ratechange)
  timestamp: number; // Date.now() when event was captured
  rate?: number; // source's playback rate at capture; required for 'ratechange'
}

export interface SyncCommandPayload {
  action: 'pause' | 'play' | 'seek' | 'ratechange';
  position: number; // absolute target position; -1 means preserve current position for pause/play
  timestamp: number; // Date.now() when command was sent
  generation: number;
  buffering?: boolean; // Pause caused by a peer stall; preserve readiness reporting.
  rate?: number; // source playback rate (used by receiver for time compensation; required for ratechange)
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
  timestamp: number; // Date.now() when position was read
}

export interface SyncStatusResponse {
  active: boolean;
  videoA: { tabId: number; title: string; domain: string } | null;
  videoB: { tabId: number; title: string; domain: string } | null;
  offset: number;
  nudgeStep: number;
}

export const NUDGE_STEPS: readonly number[] = [0.01, 0.05, 0.1, 0.5];

export const SYNC = {
  DRIFT_CHECK_INTERVAL_MS: 2000,
  DRIFT_IGNORE_THRESHOLD_MS: 50,
  DRIFT_RATE_ADJUST_THRESHOLD_MS: 150,
  RATE_ADJUST_FACTOR: 0.02,
  RATE_ADJUST_DURATION_MS: 3000,
  SEEK_DEBOUNCE_MS: 50,
  BUFFERING_STABLE_MS: 50,
  POSITION_TIMEOUT_MS: 2000,
  DEFAULT_NUDGE_STEP: 0.1,
  KEEPALIVE_RECONNECT_MS: 240_000,
  // Ping active sync ports before the worker becomes idle.
  KEEPALIVE_PING_MS: 20_000,
  // Bump on persisted session schema changes.
  STORAGE_KEY: 'syncSession_v2',
} as const;
