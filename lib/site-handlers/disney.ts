import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { MEDIA_VALIDATION } from '../constants';
import { matchesDomains } from './utils';

/**
 * Shared handler for Disney+, Hulu, and Hotstar platforms.
 */
export class DisneyHandler extends BaseSiteHandler {
    private static readonly DOMAINS = ['disneyplus.com', 'hulu.com', 'hotstar.com'] as const;

    matches(): boolean {
        return matchesDomains(DisneyHandler.DOMAINS);
    }

    getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
        const container =
            video.closest('[data-testid="btm-media-client-wrapper"]') || // Disney+
            video.closest('.Player__container') ||                      // Hulu
            video.closest('.player-base') ||                         // Hotstar
            video.closest('[class*="player"]') || video.closest('[class*="Player"]');

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
     * Filters out landing page background loops and browse page previews.
     */
    shouldIgnoreVideo(video: HTMLVideoElement): boolean {
        if (
            video.closest('[data-testid="preview-player"]') ||
            video.closest('.background-video') ||
            video.closest('[class*="background"]')
        ) {
            return true;
        }

        if (
            video.offsetWidth < MEDIA_VALIDATION.SOCIAL_MIN_WIDTH ||
            video.offsetHeight < MEDIA_VALIDATION.SOCIAL_MIN_HEIGHT
        ) {
            return true;
        }

        return false;
    }
}
