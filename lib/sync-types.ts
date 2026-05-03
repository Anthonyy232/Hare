export interface SyncSession {
  videoA: { tabId: number; frameId?: number };
  videoB: { tabId: number; frameId?: number };
  offset: number; // seconds. videoB_position = videoA_position + offset
  nudgeStep: number; // default 0.1s
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
  rate?: number; // source playback rate (used by receiver for time compensation; required for ratechange)
}

export interface DriftCorrectPayload {
  position: number;
  method: 'rate' | 'seek'; // rate = gradual playback rate adjustment, seek = hard seek
  rateFactor?: number; // e.g., 0.02 means play at baseRate + 0.02
  durationMs?: number; // how long to apply rate adjustment
}

export interface SyncPositionResponse {
  currentTime: number;
  paused: boolean;
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

export const SYNC = {
  DRIFT_CHECK_INTERVAL_MS: 2000,
  DRIFT_IGNORE_THRESHOLD_MS: 50,
  DRIFT_RATE_ADJUST_THRESHOLD_MS: 150,
  RATE_ADJUST_FACTOR: 0.02, // play at 1.02x or 0.98x to close gap
  RATE_ADJUST_DURATION_MS: 3000,
  SEEK_DEBOUNCE_MS: 50,
  SEEK_ECHO_TIMEOUT_MS: 1000,
  BUFFERING_STABLE_MS: 50,
  POSITION_TIMEOUT_MS: 2000,
  DEFAULT_NUDGE_STEP: 0.1,
  // MV3 keep-alive: reconnect the port well before Chrome's 5-minute hard
  // cap on a single port instance to prevent the service worker from being
  // terminated mid-session.
  KEEPALIVE_RECONNECT_MS: 240_000,
  // Port ping cadence — must stay under Chrome's 30s SW idle timeout.
  KEEPALIVE_PING_MS: 20_000,
  // Storage key for persisted session state in chrome.storage.session.
  // Bumped on schema changes.
  STORAGE_KEY: 'syncSession_v2',
} as const;
