import { describe, it, expect } from 'vitest';
import { isBlacklisted } from './settings';

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
