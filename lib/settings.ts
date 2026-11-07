import { storage } from '#imports';
import { DEFAULT_SETTINGS, type Settings } from './types';
import { clampBindingValue, isKeyAction, type KeyBinding, type KeyAction } from './key-actions';
import { STORAGE_KEY, CONTROLLER } from './constants';
import { logger } from './logger';

const settingsStorage = storage.defineItem<Settings>(`sync:${STORAGE_KEY}`, {
  defaultValue: DEFAULT_SETTINGS,
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function validateKeyBindings(value: unknown): KeyBinding[] {
  const stored = new Map<KeyAction, KeyBinding>();
  for (const candidate of Array.isArray(value) ? value as Array<Partial<KeyBinding> | null> : []) {
    if (candidate && isKeyAction(candidate.action) && typeof candidate.key === 'string'
      && Number.isFinite(candidate.value) && candidate.value! >= 0 && typeof candidate.force === 'boolean') {
      stored.set(candidate.action, candidate as KeyBinding);
    }
  }

  const usedKeys = new Set<string>();
  return DEFAULT_SETTINGS.keyBindings.map(defaultBinding => {
    const { action, key, value, force } = stored.get(defaultBinding.action) ?? defaultBinding;
    const uniqueKey = usedKeys.has(key) ? '' : key;
    if (uniqueKey) usedKeys.add(uniqueKey);
    return { action, key: uniqueKey, value: clampBindingValue(action, value), force };
  });
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, min, max) : fallback;
}

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

export function removeExactSiteExclusions(blacklist: string, hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return blacklist.split('\n').filter(line => {
    try {
      const rule = parsePattern(line.trim());
      return rule.type !== 'domain' || rule.pattern !== host;
    } catch { return true; }
  }).join('\n');
}

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

export function isBlacklisted(blacklist: string, hostname: string): boolean {
  const patterns = compileBlacklistPatterns(blacklist);

  const normalizedHost = hostname.toLowerCase().replace(/\.$/, '');

  return patterns.some(compiled => compiled.type === 'regex'
    ? compiled.pattern.test(hostname)
    : normalizedHost === compiled.pattern || normalizedHost.endsWith('.' + compiled.pattern));
}
