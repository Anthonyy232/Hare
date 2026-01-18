import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { matchesDomains } from './utils';
import { MEDIA_VALIDATION } from '../constants';

export class RedditHandler extends BaseSiteHandler {
    private static readonly DOMAINS = ['reddit.com', 'redd.it'] as const;

    matches(): boolean {
        return matchesDomains(RedditHandler.DOMAINS);
    }

    getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
        const container =
            video.closest('[data-testid="video-player"]') ||
            video.closest('shreddit-player') ||
            video.closest('.reddit-video-player-root');

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
     * Filters out muted feed previews and avatar decorations.
     */
    shouldIgnoreVideo(video: HTMLVideoElement): boolean {
        if (video.closest('[data-collapsed="true"]') || video.closest('[data-testid="award-animations"]')) {
            return true;
        }

        if (video.muted && video.offsetWidth < MEDIA_VALIDATION.REDDIT_MUTED_MIN_WIDTH) return true;
        if (video.offsetWidth < MEDIA_VALIDATION.REDDIT_MIN_WIDTH || video.offsetHeight < MEDIA_VALIDATION.REDDIT_MIN_HEIGHT) return true;

        return false;
    }
}
