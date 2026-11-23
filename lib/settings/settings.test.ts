import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { KeyBinding } from './key-actions';
import { DEFAULT_SETTINGS } from './schema';
import {
  includeSite,
  isBlacklisted,
  loadSettings,
  normalizeSettings,
  saveSettings,
  siteBlock,
  validateBlacklist,
  watchSettings,
} from './settings';

const normalizeKeyBindings = (keyBindings: unknown): KeyBinding[] => normalizeSettings({ keyBindings }).keyBindings;

describe('stored key bindings', () => {
  it('fills missing actions with defaults', () => {
    const bindings = normalizeKeyBindings([{ action: 'faster', key: 'KeyF', value: 0.25, force: true }]);

    expect(bindings).toHaveLength(DEFAULT_SETTINGS.keyBindings.length);
    expect(bindings.find(binding => binding.action === 'faster')).toEqual({
      action: 'faster',
      key: 'KeyF',
      value: 0.25,
      force: true,
    });
    expect(bindings.find(binding => binding.action === 'slower')).toEqual(
      DEFAULT_SETTINGS.keyBindings.find(binding => binding.action === 'slower'),
    );
  });

  it('ignores unknown actions and invalid values', () => {
    const bindings = normalizeKeyBindings([
      { action: 'rewind', key: 'KeyA', value: Number.POSITIVE_INFINITY, force: true },
      { action: 'not-real', key: 'KeyB', value: 1, force: true },
      { action: 'advance', key: 'KeyN', value: 15, force: false },
    ]);

    expect(bindings.find(binding => binding.action === 'rewind')).toEqual(
      DEFAULT_SETTINGS.keyBindings.find(binding => binding.action === 'rewind'),
    );
    expect(bindings.find(binding => binding.action === 'advance')).toEqual({
      action: 'advance',
      key: 'KeyN',
      value: 15,
      force: false,
    });
    expect(bindings).not.toContainEqual(expect.objectContaining({ action: 'not-real' }));
  });
});

describe('settings boundary', () => {
  beforeEach(() => fakeBrowser.reset());

  it('persists normalized settings and stops notifying after unwatch', async () => {
    const changed = vi.fn();
    const unwatch = watchSettings(changed);
    try {
      const stored = { ...DEFAULT_SETTINGS, controllerOpacity: 1, blacklist: 'example.com' };
      expect(await saveSettings({ ...DEFAULT_SETTINGS, controllerOpacity: 5, blacklist: 'example.com' })).toEqual(
        stored,
      );
      expect(await loadSettings()).toEqual(stored);
      await vi.waitFor(() =>
        expect(changed).toHaveBeenCalledWith(
          expect.objectContaining({ controllerOpacity: 1, blacklist: 'example.com' }),
        ),
      );
      unwatch();
      await saveSettings(DEFAULT_SETTINGS);
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      unwatch();
    }
  });

  it('normalizes corrupted storage and finite display ranges', () => {
    const settings = normalizeSettings({
      controllerOpacity: NaN,
      controllerButtonSize: Infinity,
      enabled: 'false',
      keyBindings: null,
    });
    expect(settings.controllerOpacity).toBe(DEFAULT_SETTINGS.controllerOpacity);
    expect(settings.controllerButtonSize).toBe(DEFAULT_SETTINGS.controllerButtonSize);
    expect(settings.enabled).toBe(true);
    expect(normalizeSettings({ controllerOpacity: -100, controllerButtonSize: 100 }).controllerOpacity).toBe(0.1);
    expect(normalizeSettings({ controllerOpacity: -100, controllerButtonSize: 100 }).controllerButtonSize).toBe(24);
  });
  it('does not expose shared defaults to callers', () => {
    const one = normalizeSettings(null),
      two = normalizeSettings(null);
    one.keyBindings[0].key = 'Changed';
    expect(two.keyBindings[0].key).toBe('KeyS');
    expect(DEFAULT_SETTINGS.keyBindings[0].key).toBe('KeyS');
  });
  it('preserves cleared keys and removes ambiguous duplicates', () => {
    const bindings = normalizeKeyBindings(
      DEFAULT_SETTINGS.keyBindings.map(binding => ({ ...binding, key: binding.action === 'display' ? '' : 'KeyQ' })),
    );
    expect(bindings.filter(binding => binding.key === 'KeyQ')).toHaveLength(1);
    expect(bindings.find(binding => binding.action === 'display')!.key).toBe('');
  });
  it('keeps shortcut values within their playback and seek ranges', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      keyBindings: DEFAULT_SETTINGS.keyBindings.map(binding => ({
        ...binding,
        value: binding.action === 'reset' ? 0 : 100000,
      })),
    };
    await saveSettings(settings);
    const values = Object.fromEntries(
      (await loadSettings()).keyBindings.map(binding => [binding.action, binding.value]),
    );
    expect(values).toEqual({ slower: 16, faster: 16, rewind: 86400, advance: 86400, reset: 0.07, display: 100000 });
  });
  it('falls back to the default for a negative shortcut value', () => {
    const [binding] = normalizeKeyBindings([{ action: 'display', key: 'KeyV', value: -1, force: false }]).filter(
      b => b.action === 'display',
    );
    expect(binding.value).toBe(0);
  });
  it('supports pasted URLs, wildcard domains, case and trailing dots', () => {
    for (const blacklist of ['https://Example.com/watch?x=1', '*.example.com', 'example.com.']) {
      expect(isBlacklisted(blacklist, 'SUB.EXAMPLE.COM.')).toBe(true);
      expect(isBlacklisted(blacklist, 'notexample.com')).toBe(false);
    }
  });
  it.each(['/[/', '/unfinished', 'bad domain', 'https://', 'file:///example', 'https://user:pass@example.com'])(
    'explains invalid exclusion %s',
    value => {
      expect(validateBlacklist(value)).toHaveLength(1);
    },
  );
  it('rejects invalid patterns and oversized writes without truncating data', async () => {
    await expect(saveSettings({ ...DEFAULT_SETTINGS, blacklist: '/[/' })).rejects.toThrow('Line 1');
    await expect(saveSettings({ ...DEFAULT_SETTINGS, blacklist: 'example.com\n'.repeat(1000) })).rejects.toThrow(
      'too large',
    );
  });
});

describe('site exclusions', () => {
  it('includes a site by removing equivalent exact rules and nothing else', () => {
    const blacklist = 'EXAMPLE.com.\n*.example.com\nhttps://example.com/watch\nother.test\n';
    expect(includeSite(blacklist, 'EXAMPLE.COM.')).toBe('other.test\n');
  });

  it('keeps subdomain exclusions and invalid entries when including a site', () => {
    expect(includeSite('player.example.com\nchild.player.example.com\n/unfinished', 'player.example.com')).toBe(
      'child.player.example.com\n/unfinished',
    );
  });

  it.each(['example.com', '/^player/'])('cannot include a site that %s still excludes', rule => {
    expect(includeSite(`${rule}\nplayer.example.com`, 'player.example.com')).toBeNull();
  });

  it('asks to turn Hare on before anything else', () => {
    expect(siteBlock({ ...DEFAULT_SETTINGS, enabled: false }, 'chrome://extensions')?.action).toBe('enable');
    expect(siteBlock(DEFAULT_SETTINGS, 'chrome://extensions')?.action).toBeNull();
  });

  it('offers to include an excluded site only when no broader rule excludes it', () => {
    const settings = { ...DEFAULT_SETTINGS, blacklist: 'player.example.com\n/^cdn\\./' };
    expect(siteBlock(settings, 'https://player.example.com/watch')?.action).toBe('include');
    expect(siteBlock(settings, 'https://cdn.example.com/')?.action).toBe('settings');
    expect(siteBlock(settings, 'https://example.com/')).toBeNull();
  });

  it('handles mixed content and empty lines', () => {
    expect(isBlacklisted('', 'youtube.com')).toBe(false);
    const blacklist = `
      youtube.com
      
      /.*\\.net/
    `;
    expect(isBlacklisted(blacklist, 'youtube.com')).toBe(true);
    expect(isBlacklisted(blacklist, 'example.net')).toBe(true);
    expect(isBlacklisted(blacklist, 'example.com')).toBe(false);
  });
});
