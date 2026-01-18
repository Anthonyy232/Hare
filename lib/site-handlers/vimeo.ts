import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { MEDIA_VALIDATION } from '../constants';
import { matchesDomains } from './utils';

export class VimeoHandler extends BaseSiteHandler {
    private static readonly DOMAINS = ['vimeo.com', 'player.vimeo.com'] as const;

    matches(): boolean {
        return matchesDomains(VimeoHandler.DOMAINS);
    }

    getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
        const container =
            video.closest('.vp-video') ||
            video.closest('.player-container') ||
            video.closest('.player');

        if (container) {
            return { target: container, method: 'prepend' };
        }

        const parent = video.parentElement;
        if (parent) {
            return { target: parent, method: 'prepend' };
        }

        return null;
    }

    /**
     * Prevents attaching to small thumbnails and preview posters.
     */
    shouldIgnoreVideo(video: HTMLVideoElement): boolean {
        if (video.closest('.vp-preview') || video.closest('.iris_thumbnail')) return true;

        if (
            video.offsetWidth < MEDIA_VALIDATION.SOCIAL_MIN_WIDTH ||
            video.offsetHeight < MEDIA_VALIDATION.SOCIAL_MIN_HEIGHT
        ) {
            return true;
        }

        return false;
    }
}
