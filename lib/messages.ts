/**
 * Centralized user-facing messages for consistent UX.
 */

export const MESSAGES = {
  // User-facing errors
  NO_VIDEOS_FOUND: 'No videos found on this page',
  NO_ACTIVE_TAB: 'No active tab',
  FAILED_TO_SET_SPEED: 'Failed to set speed',
  FAILED_TO_RESET_SPEED: 'Failed to reset speed',
  SPEED_CONTROL_BLOCKED: 'Speed control blocked',
  DUPLICATE_KEYBIND: 'This key is already assigned to another action.',
  SETTINGS_CONFLICT: 'Settings were changed in another tab. Save to overwrite, or reload to discard your changes.',

  // Status messages
  SPEED_LIMITED: (speed: string) => `Speed limited to ${speed}`,
  VIDEO_COUNT: (count: number) => `${count} detected`,

  // Prompts
  RESET_SETTINGS_CONFIRM: 'Reset all settings to defaults?',

  // Hints
  NAVIGATE_TO_VIDEO_HINT: 'Navigate to a page with video content',
} as const;
