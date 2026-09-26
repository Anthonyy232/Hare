import { describe, it, expect, beforeEach } from 'vitest';
import { scanMediaTree } from './media-detector';

describe('scanMediaTree', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('finds audio elements if requested', () => {
        const audio = document.createElement('audio');
        document.body.appendChild(audio);

        const mediaVideoOnly = scanMediaTree(document, false);
        expect(mediaVideoOnly.length).toBe(0);

        const mediaWithAudio = scanMediaTree(document, true);
        expect(mediaWithAudio).toEqual([audio]);
    });

    it('finds video elements nested deep in multiple Shadow DOMs', () => {
        let root: HTMLElement | ShadowRoot = document.body;
        for (let depth = 0; depth < 64; depth++) {
            const host = document.createElement('div');
            root.append(host);
            root = host.attachShadow({ mode: 'open' });
        }
        const video = document.createElement('video');
        root.append(video);

        const media = scanMediaTree(document, false);
        expect(media).toEqual([video]);
    });

    it('handles mixture of light and shadow DOM media', () => {
        const v1 = document.createElement('video');
        document.body.appendChild(v1);

        const host = document.createElement('div');
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });

        const v2 = document.createElement('video');
        shadow.appendChild(v2);

        const media = scanMediaTree(document, false);
        expect(media).toEqual([v1, v2]);
    });
});
