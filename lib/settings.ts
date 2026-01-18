import { storage } from '#imports';
import { DEFAULT_SETTINGS, type Settings, type KeyBinding } from './types';
import { STORAGE_KEY } from './constants';
import { logger } from './logger';

const settingsStorage = storage.defineItem<Settings>(`sync:${STORAGE_KEY}`, {
  defaultValue: DEFAULT_SETTINGS,
});

/**
 * Normalizes user-provided keybindings, falling back to defaults for invalid entries.
 */
function validateKeyBindings(value: unknown): KeyBinding[] {
  if (!Array.isArray(value)) {
    logger.warn('Invalid keyBindings - using defaults');
    return DEFAULT_SETTINGS.keyBindings;
  }

  const validBindings = value.filter((binding): binding is KeyBinding => {
    return (
      binding &&
      typeof binding === 'object' &&
      typeof binding.action === 'string' &&
      typeof binding.key === 'string' &&
      typeof binding.value === 'number' &&
      typeof binding.force === 'boolean'
    );
  });

  return validBindings.length > 0 ? validBindings : DEFAULT_SETTINGS.keyBindings;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await settingsStorage.getValue();

    if (!stored || typeof stored !== 'object') return DEFAULT_SETTINGS;

    return {
      enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_SETTINGS.enabled,
      enableAudio: typeof stored.enableAudio === 'boolean' ? stored.enableAudio : DEFAULT_SETTINGS.enableAudio,
      startHidden: typeof stored.startHidden === 'boolean' ? stored.startHidden : DEFAULT_SETTINGS.startHidden,
      controllerOpacity: typeof stored.controllerOpacity === 'number'
        ? stored.controllerOpacity
        : DEFAULT_SETTINGS.controllerOpacity,
      controllerButtonSize: typeof stored.controllerButtonSize === 'number'
        ? stored.controllerButtonSize
        : DEFAULT_SETTINGS.controllerButtonSize,
      keyBindings: validateKeyBindings(stored.keyBindings),
      blacklist: typeof stored.blacklist === 'string' ? stored.blacklist : DEFAULT_SETTINGS.blacklist,
    };
  } catch (error) {
    logger.warn('Failed to load settings:', error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await settingsStorage.setValue(settings);
}

export function watchSettings(
  callback: (newSettings: Settings, oldSettings: Settings) => void
): () => void {
  return settingsStorage.watch((newVal, oldVal) => {
    try {
      callback(newVal ?? DEFAULT_SETTINGS, oldVal ?? DEFAULT_SETTINGS);
    } catch (error) {
      logger.error('Settings watch callback error:', error);
    }
  });
}

export async function resetSettings(): Promise<Settings> {
  await settingsStorage.setValue(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

type CompiledPattern = { type: 'regex'; pattern: RegExp } | { type: 'domain'; pattern: string };
let cachedBlacklist = '';
let cachedPatterns: CompiledPattern[] = [];

/**
 * Compiles the blacklist string into an executable array of regex/domain patterns.
 * Results are cached to avoid expensive string parsing during frequent media detection checks.
 */
function compileBlacklistPatterns(blacklist: string): CompiledPattern[] {
  if (blacklist === cachedBlacklist) return cachedPatterns;

  cachedBlacklist = blacklist;
  cachedPatterns = [];

  if (!blacklist.trim()) return cachedPatterns;

  const lines = blacklist.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (line.startsWith('/') && line.endsWith('/')) {
      try {
        cachedPatterns.push({ type: 'regex', pattern: new RegExp(line.slice(1, -1), 'i') });
      } catch (error) {
        logger.warn('Invalid regex pattern in blacklist:', line, error);
      }
    } else {
      cachedPatterns.push({ type: 'domain', pattern: line.toLowerCase() });
    }
  }

  return cachedPatterns;
}

/**
 * Performs a broad check against the current hostname to determine if the controller
 * should be active. Supports both exact domain matches and regex patterns.
 */
export function isBlacklisted(blacklist: string, hostname: string): boolean {
  const patterns = compileBlacklistPatterns(blacklist);
  if (patterns.length === 0) return false;

  const normalizedHost = hostname.toLowerCase();

  for (const compiled of patterns) {
    if (compiled.type === 'regex') {
      if (compiled.pattern.test(hostname)) return true;
    } else {
      if (normalizedHost === compiled.pattern || normalizedHost.endsWith('.' + compiled.pattern)) {
        return true;
      }
    }
  }

  return false;
}
