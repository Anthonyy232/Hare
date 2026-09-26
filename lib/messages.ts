export const MESSAGES = {
  NO_ACTIVE_TAB: 'No active tab',
  SPEED_CONTROL_BLOCKED: 'Speed control blocked',
  DUPLICATE_KEYBIND: 'This key is already assigned to another action.',
  SETTINGS_CONFLICT: 'Settings were changed in another tab. Save to overwrite, or reload to discard your changes.',
  SPEED_LIMITED: (speed: string) => `Speed limited to ${speed}`,
  RESET_SETTINGS_CONFIRM: 'Reset all settings to defaults?',
} as const;
