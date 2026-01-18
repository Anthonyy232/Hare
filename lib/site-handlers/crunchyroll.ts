import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { MEDIA_VALIDATION } from '../constants';
import { matchesDomains } from './utils';

export class CrunchyrollHandler extends BaseSiteHandler {
    private static readonly DOMAINS = ['crunchyroll.com'] as const;

    matches(): boolean {
        return matchesDomains(CrunchyrollHandler.DOMAINS);
    }

    getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
        const container =
            video.closest('#vilos') ||
            video.closest('[data-testid="vilos-player"]') ||
            video.closest('.video-player') ||
            video.closest('.erc-video-player');

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
     * Filters out hero carousels and browse card previews common in the CR interface.
     */
    shouldIgnoreVideo(video: HTMLVideoElement): boolean {
        if (
            video.closest('[data-testid="trailer-player"]') ||
            video.closest('.hero-carousel') ||
            video.closest('[class*="Hero"]') ||
            video.closest('.browse-card')
        ) {
            return true;
        }

        if (
            video.offsetWidth < MEDIA_VALIDATION.STREAMING_MIN_WIDTH ||
            video.offsetHeight < MEDIA_VALIDATION.STREAMING_MIN_HEIGHT
        ) {
            return true;
        }

        return false;
    }
}
