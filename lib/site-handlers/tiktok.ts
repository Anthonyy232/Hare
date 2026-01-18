import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { matchesDomains } from './utils';
import { MEDIA_VALIDATION } from '../constants';

export class TikTokHandler extends BaseSiteHandler {
    private static readonly DOMAINS = ['tiktok.com'] as const;

    matches(): boolean {
        return matchesDomains(TikTokHandler.DOMAINS);
    }

    getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
        const container =
            video.closest('[data-e2e="video-player"]') ||
            video.closest('[data-e2e="browse-video"]') ||
            video.closest('.tiktok-player');

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
     * Ignores sidebar recommendations and muted preview loops in the feed.
     */
    shouldIgnoreVideo(video: HTMLVideoElement): boolean {
        if (
            video.closest('[data-e2e="recommend-list-item"]') ||
            video.closest('[data-e2e="user-card"]')
        ) {
            return true;
        }

        if (video.offsetWidth < MEDIA_VALIDATION.TIKTOK_MIN_WIDTH || video.offsetHeight < MEDIA_VALIDATION.TIKTOK_MIN_HEIGHT) return true;
        if (video.muted && video.loop && video.offsetHeight < MEDIA_VALIDATION.TIKTOK_LOOP_MIN_HEIGHT) return true;

        return false;
    }
}
