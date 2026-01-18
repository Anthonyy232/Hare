import { describe, it, expect } from 'vitest';
import { matchesDomains } from './utils';
import { beforeEach, afterEach } from 'vitest';

describe('matchesDomains', () => {
    const originalLocation = window.location;

    beforeEach(() => {
        // Mock window.location for testing
        // @ts-expect-error - Happy-DOM allows rewriting location
        delete window.location;
        // @ts-expect-error - Partial Location mock for testing
        window.location = { hostname: '' };
    });

    afterEach(() => {
        // @ts-expect-error - Restoring original location
        window.location = originalLocation;
    });

    const setHostname = (hostname: string) => {
        window.location.hostname = hostname;
    };

    it('matches exact domain', () => {
        setHostname('youtube.com');
        expect(matchesDomains(['youtube.com'])).toBe(true);
    });

    it('matches subdomain', () => {
        setHostname('www.youtube.com');
        expect(matchesDomains(['youtube.com'])).toBe(true);
    });

    it('does not match partial domain suffix', () => {
        setHostname('omyyoutube.com');
        expect(matchesDomains(['youtube.com'])).toBe(false);
    });

    it('does not match unrelated domain', () => {
        setHostname('twitch.tv');
        expect(matchesDomains(['youtube.com'])).toBe(false);
    });

    it('matches multiple domains', () => {
        setHostname('vimeo.com');
        expect(matchesDomains(['youtube.com', 'vimeo.com'])).toBe(true);
    });
});
