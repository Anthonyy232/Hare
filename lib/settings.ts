import { storage } from '#imports';
import { DEFAULT_SETTINGS, type Settings, type KeyBinding, type KeyAction } from './types';
import { STORAGE_KEY, CONTROLLER, SPEED } from './constants';
import { logger } from './logger';

const settingsStorage = storage.defineItem<Settings>(`sync:${STORAGE_KEY}`, {
  defaultValue: DEFAULT_SETTINGS,
});

/**
 * Normalizes user-provided keybindings, falling back to defaults for invalid entries.
 */
const DEFAULT_KEY_ACTIONS = new Set(DEFAULT_SETTINGS.keyBindings.map((binding) => binding.action));

function cloneBinding(binding: KeyBinding): KeyBinding {
  return { ...binding };
}

function isKnownKeyAction(value: unknown): value is KeyAction {
  return typeof value === 'string' && DEFAULT_KEY_ACTIONS.has(value as KeyAction);
}

export function validateKeyBindings(value: unknown): KeyBinding[] {
  if (!Array.isArray(value)) {
    logger.warn('Invalid keyBindings - using defaults');
    return DEFAULT_SETTINGS.keyBindings.map(cloneBinding);
  }

  const validBindings = new Map<KeyAction, KeyBinding>();

  for (const binding of value) {
    const candidate = binding as Partial<KeyBinding>;
    if (
      binding &&
      typeof binding === 'object' &&
      isKnownKeyAction(candidate.action) &&
      typeof candidate.key === 'string' &&
      typeof candidate.value === 'number' &&
      Number.isFinite(candidate.value) &&
      candidate.value >= 0 &&
      typeof candidate.force === 'boolean'
    ) {
      validBindings.set(candidate.action, {
        action: candidate.action,
        key: candidate.key,
        value: candidate.value,
        force: candidate.force,
      });
    }
  }

  const usedKeys = new Set<string>();
  return DEFAULT_SETTINGS.keyBindings.map((defaultBinding) => {
    const binding = cloneBinding(validBindings.get(defaultBinding.action) ?? defaultBinding);
    // A duplicate shortcut can only execute one action. Keep the first assignment.
    if (usedKeys.has(binding.key)) binding.key = '';
    if (binding.key) usedKeys.add(binding.key);
    if (binding.action === 'reset') binding.value = clampNumber(binding.value, SPEED.MIN, SPEED.MAX, 1);
    if (binding.action === 'faster' || binding.action === 'slower') {
      binding.value = clampNumber(binding.value, 0.01, SPEED.MAX, defaultBinding.value);
    }
    if (binding.action === 'rewind' || binding.action === 'advance') {
      binding.value = clampNumber(binding.value, 0.01, 86400, defaultBinding.value);
    }
    return binding;
  });
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value)) : fallback;
}

/** Use the same boundary for storage reads, writes, and live updates. Always returns a fresh object. */
export function normalizeSettings(value: unknown): Settings {
  const stored = value && typeof value === 'object' ? value as Partial<Settings> : {};
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_SETTINGS.enabled,
    enableAudio: typeof stored.enableAudio === 'boolean' ? stored.enableAudio : DEFAULT_SETTINGS.enableAudio,
    startHidden: typeof stored.startHidden === 'boolean' ? stored.startHidden : DEFAULT_SETTINGS.startHidden,
    controllerOpacity: clampNumber(stored.controllerOpacity, CONTROLLER.MIN_OPACITY, CONTROLLER.MAX_OPACITY, DEFAULT_SETTINGS.controllerOpacity),
    controllerButtonSize: Math.round(clampNumber(stored.controllerButtonSize, CONTROLLER.MIN_BUTTON_SIZE, CONTROLLER.MAX_BUTTON_SIZE, DEFAULT_SETTINGS.controllerButtonSize)),
    keyBindings: validateKeyBindings(stored.keyBindings),
    blacklist: typeof stored.blacklist === 'string' ? stored.blacklist : DEFAULT_SETTINGS.blacklist,
  };
}

export async function loadSettings(options: { strict?: boolean } = {}): Promise<Settings> {
  try {
    return normalizeSettings(await settingsStorage.getValue());
  } catch (error) {
    if (options.strict) throw error;
    logger.warn('Failed to load settings:', error);
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const normalized = normalizeSettings(settings);
  const errors = validateBlacklist(normalized.blacklist);
  if (errors.length) throw new Error(errors[0]);
  if (new TextEncoder().encode(STORAGE_KEY + JSON.stringify(normalized)).length > 8192) {
    throw new Error('Settings are too large to sync. Shorten the excluded sites list and try again.');
  }
  await settingsStorage.setValue(normalized);
}

export function watchSettings(
  callback: (newSettings: Settings, oldSettings: Settings) => void
): () => void {
  return settingsStorage.watch((newVal, oldVal) => {
    try {
      callback(normalizeSettings(newVal), normalizeSettings(oldVal));
    } catch (error) {
      logger.error('Settings watch callback error:', error);
    }
  });
}

export async function resetSettings(): Promise<Settings> {
  const settings = normalizeSettings(DEFAULT_SETTINGS);
  await saveSettings(settings);
  return settings;
}

type CompiledPattern = { type: 'regex'; pattern: RegExp } | { type: 'domain'; pattern: string };
let cachedBlacklist = '';
let cachedPatterns: CompiledPattern[] = [];

function parsePattern(line: string): CompiledPattern {
  if (line.startsWith('/') && line.endsWith('/')) {
    return { type: 'regex', pattern: new RegExp(line.slice(1, -1), 'i') };
  }
  if (line.startsWith('/')) throw new Error('Regular expressions must end with /');
  const normalized = line.replace(/^\*\./, '');
  const url = new URL(normalized.includes('://') ? normalized : `https://${normalized}`);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /[\s*]/.test(normalized)) throw new Error('Invalid domain');
  return { type: 'domain', pattern: url.hostname.toLowerCase().replace(/\.$/, '') };
}

export function validateBlacklist(blacklist: string): string[] {
  return blacklist.split('\n').flatMap((line, index) => {
    if (!line.trim()) return [];
    try { parsePattern(line.trim()); return []; }
    catch { return [`Line ${index + 1}: enter a valid domain, URL, or /regular expression/.`]; }
  });
}

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
    try { cachedPatterns.push(parsePattern(line)); }
    catch { logger.warn('Invalid excluded-site pattern:', line); }
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

  const normalizedHost = hostname.toLowerCase().replace(/\.$/, '');

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
