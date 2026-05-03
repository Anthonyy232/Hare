import { describe, it, expect } from 'vitest';
import { validateKeyBindings, isBlacklisted } from './settings';
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
