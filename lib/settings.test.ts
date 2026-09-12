import { describe, it, expect } from 'vitest';
import { validateKeyBindings, isBlacklisted, normalizeSettings, saveSettings, validateBlacklist } from './settings';
import { DEFAULT_SETTINGS } from './types';

describe('validateKeyBindings', () => {
    it('fills missing actions with defaults', () => {
        const bindings = validateKeyBindings([
            { action: 'faster', key: 'KeyF', value: 0.25, force: true },
        ]);

        expect(bindings).toHaveLength(DEFAULT_SETTINGS.keyBindings.length);
        expect(bindings.find((binding) => binding.action === 'faster')).toEqual({
            action: 'faster',
            key: 'KeyF',
            value: 0.25,
            force: true,
        });
        expect(bindings.find((binding) => binding.action === 'slower')).toEqual(
            DEFAULT_SETTINGS.keyBindings.find((binding) => binding.action === 'slower')
        );
    });

    it('ignores unknown actions and invalid values', () => {
        const bindings = validateKeyBindings([
            { action: 'rewind', key: 'KeyA', value: Number.POSITIVE_INFINITY, force: true },
            { action: 'not-real', key: 'KeyB', value: 1, force: true },
            { action: 'advance', key: 'KeyN', value: 15, force: false },
        ]);

        expect(bindings.find((binding) => binding.action === 'rewind')).toEqual(
            DEFAULT_SETTINGS.keyBindings.find((binding) => binding.action === 'rewind')
        );
        expect(bindings.find((binding) => binding.action === 'advance')).toEqual({
            action: 'advance',
            key: 'KeyN',
            value: 15,
            force: false,
        });
        expect(bindings).not.toContainEqual(expect.objectContaining({ action: 'not-real' }));
    });
});

describe('settings boundary', () => {
    it('normalizes corrupted storage and finite display ranges', () => {
        const settings = normalizeSettings({ controllerOpacity: NaN, controllerButtonSize: Infinity, enabled: 'false', keyBindings: null });
        expect(settings.controllerOpacity).toBe(DEFAULT_SETTINGS.controllerOpacity);
        expect(settings.controllerButtonSize).toBe(DEFAULT_SETTINGS.controllerButtonSize);
        expect(settings.enabled).toBe(true);
        expect(normalizeSettings({ controllerOpacity: -100, controllerButtonSize: 100 }).controllerOpacity).toBe(0.1);
        expect(normalizeSettings({ controllerOpacity: -100, controllerButtonSize: 100 }).controllerButtonSize).toBe(24);
    });
    it('does not expose shared defaults to callers', () => {
        const one = normalizeSettings(null), two = normalizeSettings(null);
        one.keyBindings[0].key = 'Changed';
        expect(two.keyBindings[0].key).toBe('KeyS');
        expect(DEFAULT_SETTINGS.keyBindings[0].key).toBe('KeyS');
    });
    it('preserves cleared keys and removes ambiguous duplicates', () => {
        const bindings = validateKeyBindings(DEFAULT_SETTINGS.keyBindings.map(binding => ({ ...binding, key: binding.action === 'display' ? '' : 'KeyQ' })));
        expect(bindings.filter(binding => binding.key === 'KeyQ')).toHaveLength(1);
        expect(bindings.find(binding => binding.action === 'display')!.key).toBe('');
    });
    it('supports pasted URLs, wildcard domains, case and trailing dots', () => {
        for (const blacklist of ['https://Example.com/watch?x=1', '*.example.com', 'example.com.']) {
            expect(isBlacklisted(blacklist, 'SUB.EXAMPLE.COM.')).toBe(true);
            expect(isBlacklisted(blacklist, 'notexample.com')).toBe(false);
        }
    });
    it.each(['/[/','/unfinished','bad domain', 'https://', 'file:///example', 'https://user:pass@example.com'])('explains invalid exclusion %s', value => {
        expect(validateBlacklist(value)).toHaveLength(1);
    });
    it('rejects invalid patterns and oversized writes without truncating data', async () => {
        await expect(saveSettings({ ...DEFAULT_SETTINGS, blacklist: '/[/' })).rejects.toThrow('Line 1');
        await expect(saveSettings({ ...DEFAULT_SETTINGS, blacklist: 'example.com\n'.repeat(1000) })).rejects.toThrow('too large');
    });
});

describe('isBlacklisted', () => {
    it('returns false for empty blacklist', () => {
        expect(isBlacklisted('', 'youtube.com')).toBe(false);
    });

    it('matches exact domains', () => {
        const blacklist = `
      youtube.com
      twitch.tv
    `;
        expect(isBlacklisted(blacklist, 'youtube.com')).toBe(true);
        expect(isBlacklisted(blacklist, 'twitch.tv')).toBe(true);
        expect(isBlacklisted(blacklist, 'google.com')).toBe(false);
    });

    it('matches subdomains', () => {
        const blacklist = 'example.com';
        expect(isBlacklisted(blacklist, 'sub.example.com')).toBe(true);
        expect(isBlacklisted(blacklist, 'example.com')).toBe(true);
        expect(isBlacklisted(blacklist, 'myexample.com')).toBe(false);
    });

    it('matches regex patterns', () => {
        const blacklist = '/^http.*\\.com$/i';
        // isBlacklisted expects hostname, so the regex should match hostname
        // But let's check the implementation. It creates regex from lines /.../

        // Test a simpler regex: /.*\.google\.com/
        const blacklistRegex = '/.*\\.google\\.com/';
        expect(isBlacklisted(blacklistRegex, 'mail.google.com')).toBe(true);
        expect(isBlacklisted(blacklistRegex, 'yahoo.com')).toBe(false);
    });

    it('handles mixed content and empty lines', () => {
        const blacklist = `
      youtube.com
      
      /.*\\.net/
    `;
        expect(isBlacklisted(blacklist, 'youtube.com')).toBe(true);
        expect(isBlacklisted(blacklist, 'example.net')).toBe(true);
        expect(isBlacklisted(blacklist, 'example.com')).toBe(false);
    });
});
