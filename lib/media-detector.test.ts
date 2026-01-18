import { describe, it, expect, beforeEach } from 'vitest';
import { findAllMedia } from './media-detector';

describe('findAllMedia', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('finds video elements in document body', () => {
        const video = document.createElement('video');
        document.body.appendChild(video);

        const media = findAllMedia(document, false);
        expect(media).toContain(video);
        expect(media.length).toBe(1);
    });

    it('finds audio elements if requested', () => {
        const audio = document.createElement('audio');
        document.body.appendChild(audio);

        const mediaVideoOnly = findAllMedia(document, false);
        expect(mediaVideoOnly.length).toBe(0);

        const mediaWithAudio = findAllMedia(document, true);
        expect(mediaWithAudio).toContain(audio);
        expect(mediaWithAudio.length).toBe(1);
    });

    it('finds video elements inside Shadow DOM', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });

        const video = document.createElement('video');
        shadow.appendChild(video);

        const media = findAllMedia(document, false);
        expect(media).toContain(video);
        expect(media.length).toBe(1);
    });

    it('finds video elements nested deep in multiple Shadow DOMs', () => {
        const host1 = document.createElement('div');
        document.body.appendChild(host1);
        const shadow1 = host1.attachShadow({ mode: 'open' });

        const host2 = document.createElement('div');
        shadow1.appendChild(host2);
        const shadow2 = host2.attachShadow({ mode: 'open' });

        const video = document.createElement('video');
        shadow2.appendChild(video);

        const media = findAllMedia(document, false);
        expect(media).toContain(video);
        expect(media.length).toBe(1);
    });

    it('handles mixture of light and shadow DOM media', () => {
        const v1 = document.createElement('video');
        document.body.appendChild(v1);

        const host = document.createElement('div');
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });

        const v2 = document.createElement('video');
        shadow.appendChild(v2);

        const media = findAllMedia(document, false);
        expect(media.length).toBe(2);
        expect(media).toContain(v1);
        expect(media).toContain(v2);
    });
});
