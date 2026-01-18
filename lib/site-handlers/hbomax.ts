import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { MEDIA_VALIDATION } from '../constants';
import { matchesDomains } from './utils';

/**
 * Handler for Max (formerly HBO Max). Supports legacy and new domains.
 */
export class HBOMaxHandler extends BaseSiteHandler {
    private static readonly DOMAINS = ['max.com', 'hbomax.com'] as const;

    matches(): boolean {
        return matchesDomains(HBOMaxHandler.DOMAINS);
    }

    getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
        const container =
            video.closest('[data-testid="player"]') ||
            video.closest('.VideoPlayer') ||
            video.closest('[class*="PlayerContainer"]');

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
     * Ignores trailer previews and hero promotional videos on the home page.
     */
    shouldIgnoreVideo(video: HTMLVideoElement): boolean {
        if (
            video.closest('[data-testid="trailer-player"]') ||
            video.closest('.HeroPlayer') ||
            video.closest('[class*="Preview"]')
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
