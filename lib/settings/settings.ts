import { storage } from '#imports';
import { BUTTON_SIZE_RANGE, DEFAULT_SETTINGS, OPACITY_RANGE, type Settings } from './schema';
import { clampBindingValue, isKeyAction, type KeyBinding, type KeyAction } from './key-actions';
import { isHarePage, matchesDomain, normalizeHost } from '../hostname';

const STORAGE_KEY = 'hare-settings';
// chrome.storage.sync's per-item quota.
const MAX_STORED_BYTES = 8192;

const settingsStorage = storage.defineItem<Settings>(`sync:${STORAGE_KEY}`, {
  defaultValue: DEFAULT_SETTINGS,
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function normalizeKeyBindings(value: unknown): KeyBinding[] {
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

function clampNumber(value: unknown, range: { MIN: number; MAX: number }, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, range.MIN, range.MAX) : fallback;
}

export function normalizeSettings(value: unknown): Settings {
  const stored = value && typeof value === 'object' ? value as Partial<Settings> : {};
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_SETTINGS.enabled,
    enableAudio: typeof stored.enableAudio === 'boolean' ? stored.enableAudio : DEFAULT_SETTINGS.enableAudio,
    startHidden: typeof stored.startHidden === 'boolean' ? stored.startHidden : DEFAULT_SETTINGS.startHidden,
    controllerOpacity: clampNumber(stored.controllerOpacity, OPACITY_RANGE, DEFAULT_SETTINGS.controllerOpacity),
    controllerButtonSize: Math.round(clampNumber(stored.controllerButtonSize, BUTTON_SIZE_RANGE, DEFAULT_SETTINGS.controllerButtonSize)),
    keyBindings: normalizeKeyBindings(stored.keyBindings),
    blacklist: typeof stored.blacklist === 'string' ? stored.blacklist : DEFAULT_SETTINGS.blacklist,
  };
}

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await settingsStorage.getValue());
}

/** Saves the normalized form of `settings` and returns it. */
export async function saveSettings(settings: Settings): Promise<Settings> {
  const normalized = normalizeSettings(settings);
  const errors = validateBlacklist(normalized.blacklist);
  if (errors.length) throw new Error(errors[0]);
  if (new TextEncoder().encode(STORAGE_KEY + JSON.stringify(normalized)).length > MAX_STORED_BYTES) {
    throw new Error('Settings are too large to sync. Shorten the excluded sites list and try again.');
  }
  await settingsStorage.setValue(normalized);
  return normalized;
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return settingsStorage.watch(stored => callback(normalizeSettings(stored)));
}

export function resetSettings(): Promise<Settings> {
  return saveSettings(DEFAULT_SETTINGS);
}

type Rule = { type: 'regex'; pattern: RegExp } | { type: 'domain'; pattern: string };

function parseRule(line: string): Rule {
  if (line.startsWith('/') && line.endsWith('/')) {
    return { type: 'regex', pattern: new RegExp(line.slice(1, -1), 'i') };
  }
  if (line.startsWith('/')) throw new Error('Regular expressions must end with /');
  const normalized = line.replace(/^\*\./, '');
  const url = new URL(normalized.includes('://') ? normalized : `https://${normalized}`);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /[\s*]/.test(normalized)) throw new Error('Invalid domain');
  return { type: 'domain', pattern: normalizeHost(url.hostname) };
}

/** Every line of the list with its rule: null for a blank line or one that isn't a rule. */
function parseBlacklist(blacklist: string): Array<{ line: string; rule: Rule | null }> {
  return blacklist.split('\n').map(line => {
    try { return { line, rule: line.trim() ? parseRule(line.trim()) : null }; }
    catch { return { line, rule: null }; }
  });
}

export function validateBlacklist(blacklist: string): string[] {
  return parseBlacklist(blacklist).flatMap(({ line, rule }, index) =>
    line.trim() && !rule ? [`Line ${index + 1}: enter a valid domain, URL, or /regular expression/.`] : []);
}

export function isBlacklisted(blacklist: string, hostname: string): boolean {
  return parseBlacklist(blacklist).some(({ rule }) => rule !== null && (rule.type === 'regex'
    ? rule.pattern.test(hostname)
    : matchesDomain(hostname, rule.pattern)));
}

/**
 * The excluded-sites list without the rules naming exactly this site,
 * or null when a broader domain or regular expression would still exclude it.
 */
export function includeSite(blacklist: string, hostname: string): string | null {
  const host = normalizeHost(hostname);
  const remaining = parseBlacklist(blacklist)
    .filter(({ rule }) => rule?.type !== 'domain' || rule.pattern !== host)
    .map(({ line }) => line).join('\n');
  return isBlacklisted(remaining, hostname) ? null : remaining;
}

export type SiteAction = 'enable' | 'include' | 'settings';

/** Why Hare can't run on a page, with the step that would let it, or null when it can. */
export function siteBlock(settings: Settings, url: string): { reason: string; hint: string; action: SiteAction | null } | null {
  if (!settings.enabled) return { reason: 'Hare is turned off', hint: 'Enable Hare to control playback.', action: 'enable' };
  if (!isHarePage(url)) return { reason: 'Hare cannot run on this browser page', hint: 'Open a regular webpage with video or audio.', action: null };
  const { hostname } = new URL(url);
  if (!isBlacklisted(settings.blacklist, hostname)) return null;
  return includeSite(settings.blacklist, hostname) === null
    ? { reason: 'This site is excluded', hint: 'A broader domain or regular expression excludes this site. Edit the excluded sites in Settings to use Hare here.', action: 'settings' }
    : { reason: 'This site is excluded', hint: 'Use Hare on this site to restore playback controls, including embedded players.', action: 'include' };
}
