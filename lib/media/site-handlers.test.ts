import { describe, expect, it } from 'vitest';
import { getSiteHandler } from './site-handlers';

describe('getSiteHandler', () => {
    // A zero-size video is ignored by every site rule's minimum size, and never by the generic handler.
    it.each([
        ['youtube.com', true],
        ['www.youtube.com', true],
        ['WWW.YouTube.com.', true],
        ['omyyoutube.com', false],
        ['example.com', false],
    ])('applies YouTube rules on %s: %s', (hostname, expected) => {
        expect(getSiteHandler(hostname).shouldIgnoreVideo(document.createElement('video'))).toBe(expected);
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
