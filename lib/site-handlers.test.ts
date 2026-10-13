import { describe, expect, it } from 'vitest';
import { genericHandler, getSiteHandler, matchesDomains } from './site-handlers';

describe('matchesDomains', () => {
    it.each([
        ['youtube.com', true],
        ['www.youtube.com', true],
        ['omyyoutube.com', false],
        ['twitch.tv', false],
        ['vimeo.com', true],
    ])('matches %s: %s', (hostname, expected) => {
        expect(matchesDomains(hostname, ['youtube.com', 'vimeo.com'])).toBe(expected);
    });
});

describe('getSiteHandler', () => {
    it('falls back to the generic handler for unknown sites', () => {
        expect(getSiteHandler('example.com')).toBe(genericHandler);
        expect(getSiteHandler('www.youtube.com')).not.toBe(genericHandler);
    });

    it('prefers containers in priority order over the nearest match', () => {
        document.body.innerHTML = '<div id="vilos"><div class="video-player"><video></video></div></div>';
        const video = document.querySelector('video')!;
        expect(getSiteHandler('crunchyroll.com').findContainer(video)?.id).toBe('vilos');
    });

    it('mounts Amazon players next to the video.js tech element', () => {
        document.body.innerHTML = '<div class="webPlayerContainer"><div id="tech-parent"><video class="vjs-tech"></video></div></div>';
        const video = document.querySelector('video')!;
        expect(getSiteHandler('www.amazon.com').findContainer(video)?.id).toBe('tech-parent');
    });
});
