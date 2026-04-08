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
  favIconUrl?: string;
}

export interface SyncEventPayload {
  action: 'pause' | 'play' | 'seek' | 'buffering_start' | 'buffering_end';
  position: number; // absolute currentTime
  timestamp: number; // Date.now() when event was captured
}

export interface SyncCommandPayload {
  action: 'pause' | 'play' | 'seek';
  position: number; // absolute target position (already offset-adjusted)
  timestamp: number; // Date.now() when command was sent
  generation: number;
}

export interface DriftCorrectPayload {
  position: number;
  generation: number;
  method: 'rate' | 'seek'; // rate = gradual playback rate adjustment, seek = hard seek
  rateFactor?: number; // e.g., 0.02 means play at baseRate + 0.02
  durationMs?: number; // how long to apply rate adjustment
}

export interface SyncPositionRequest {
  requestId: string;
}

export interface SyncPositionResponse {
  currentTime: number;
  paused: boolean;
  timestamp: number; // Date.now() when position was read
  requestId: string;
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
  BUFFERING_STABLE_MS: 50,
  POSITION_TIMEOUT_MS: 2000,
  DEFAULT_NUDGE_STEP: 0.1,
  // MV3 keep-alive: reconnect the port well before Chrome's 5-minute hard
  // cap on a single port instance to prevent the service worker from being
  // terminated mid-session.
  KEEPALIVE_RECONNECT_MS: 240_000,
  // Storage key for persisted session state in chrome.storage.session.
  // Bumped on schema changes.
  STORAGE_KEY: 'syncSession_v1',
} as const;
