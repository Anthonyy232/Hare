export const SPEED = {
  MIN: 0.07,
  MAX: 16,
  DEFAULT: 1.0,
  STEP: 0.1,
  /** Tolerance for speed comparison to handle floating-point precision issues */
  TOLERANCE: 0.01,
} as const;

export const SEEK = {
  DEFAULT_SECONDS: 10,
  /** HTMLMediaElement.HAVE_METADATA - safest minimum state for seeking. */
  MIN_READY_STATE: 1,
} as const;

export const CONTROLLER = {
  ELEMENT_TAG: 'hare-controller',
  MIN_OPACITY: 0.1,
  MAX_OPACITY: 1.0,
  MIN_BUTTON_SIZE: 10,
  MAX_BUTTON_SIZE: 24,
  DEFAULT_OFFSET_X: 10,
  DEFAULT_OFFSET_Y: 10,
  BOUNDARY_PADDING: 10,
  /** High enough to beat common player overlays, but stays below system modals. */
  Z_INDEX: 999999,
} as const;

export const MEDIA_VALIDATION = {
  MIN_WIDTH: 100,
  MIN_HEIGHT: 100,
  /** Thresholds for streaming services to filter out previews/ads. */
  STREAMING_MIN_WIDTH: 300,
  STREAMING_MIN_HEIGHT: 170,
  SOCIAL_MIN_WIDTH: 200,
  SOCIAL_MIN_HEIGHT: 150,
  /** Site-specific dimension thresholds for filtering decorative videos */
  TWITTER_SMALL_WIDTH: 150,
  TWITTER_SMALL_HEIGHT: 100,
  TWITTER_MUTED_MIN_WIDTH: 300,
  TWITTER_AD_MIN_WIDTH: 400,
  TIKTOK_MIN_WIDTH: 200,
  TIKTOK_MIN_HEIGHT: 300,
  TIKTOK_LOOP_MIN_HEIGHT: 400,
  REDDIT_MIN_WIDTH: 300,
  REDDIT_MIN_HEIGHT: 200,
  REDDIT_MUTED_MIN_WIDTH: 400,
} as const;

export const OBSERVER = {
  DEBOUNCE_MS: 50,
  IDLE_TIMEOUT_MS: 100,
  /** Limit depth to avoid stack exhaustion in exceptionally messy DOMs. */
  MAX_SHADOW_DEPTH: 50,
} as const;

export const CLEANUP = {
  STALE_CHECK_INTERVAL_MS: 5000,
  /** Timeout for deferred video element checks before cleanup */
  DEFERRED_VIDEO_TIMEOUT_MS: 30000,
} as const;

export const UI = {
  TOAST_DURATION_MS: 2000,
  SAVE_FEEDBACK_MS: 2000,
  OSD_FADE_MS: 800,
} as const;

export const STORAGE_KEY = 'hare-settings' as const;
