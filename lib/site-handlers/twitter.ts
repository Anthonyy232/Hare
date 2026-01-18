import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { matchesDomains } from './utils';
import { MEDIA_VALIDATION } from '../constants';

export class TwitterHandler extends BaseSiteHandler {
    private static readonly DOMAINS = ['twitter.com', 'x.com'] as const;

    matches(): boolean {
        return matchesDomains(TwitterHandler.DOMAINS);
    }

    getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
        const container =
            video.closest('[data-testid="videoPlayer"]') ||
            video.closest('[data-testid="tweetPhoto"]') ||
            video.closest('[data-testid="videoComponent"]');

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
     * Filters out header decorations and small format promoted videos.
     */
    shouldIgnoreVideo(video: HTMLVideoElement): boolean {
        if (video.closest('[data-testid="UserProfileHeader_Items"]')) return true;

        if (video.muted && video.offsetWidth < MEDIA_VALIDATION.TWITTER_MUTED_MIN_WIDTH) return true;
        if (video.offsetWidth < MEDIA_VALIDATION.TWITTER_SMALL_WIDTH || video.offsetHeight < MEDIA_VALIDATION.TWITTER_SMALL_HEIGHT) return true;
        if (video.closest('[data-testid="placementTracking"]') && video.offsetWidth < MEDIA_VALIDATION.TWITTER_AD_MIN_WIDTH) return true;

        return false;
    }
}
