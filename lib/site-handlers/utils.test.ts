import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchesDomains } from './utils';

describe('matchesDomains', () => {
    afterEach(() => vi.unstubAllGlobals());

    it.each([
        ['youtube.com', true],
        ['www.youtube.com', true],
        ['omyyoutube.com', false],
        ['twitch.tv', false],
        ['vimeo.com', true],
    ])('matches %s: %s', (hostname, expected) => {
        vi.stubGlobal('location', new URL(`https://${hostname}`));
        expect(matchesDomains(['youtube.com', 'vimeo.com'])).toBe(expected);
    });
});
