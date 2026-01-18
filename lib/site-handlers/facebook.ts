import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { matchesDomains } from './utils';

export class FacebookHandler extends BaseSiteHandler {
    private static readonly DOMAINS = ['facebook.com', 'fb.com', 'fb.watch'] as const;

    matches(): boolean {
        return matchesDomains(FacebookHandler.DOMAINS);
    }

    getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
        const container =
            video.closest('[data-pagelet="WatchPermalinkVideo"]') ||
            video.closest('[data-video-id]') ||
            video.closest('[data-pagelet*="Reels"]') ||
            video.closest('[role="presentation"]');

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
     * Filters out transient content like Stories, Reels previews, and profile videos.
     */
    shouldIgnoreVideo(video: HTMLVideoElement): boolean {
        if (
            video.closest('[data-pagelet="Stories"]') ||
            video.closest('[aria-label*="Stories"]') ||
            video.closest('[data-pagelet="ProfilePhoto"]') ||
            video.closest('[data-ad-preview]') ||
            video.closest('[data-pagelet*="AdPreferences"]')
        ) {
            return true;
        }

        // Heuristics for small, often muted feed previews.
        if (video.offsetWidth < 100 || video.offsetHeight < 100) return true;
        if (video.muted && video.offsetWidth < 300) return true;

        return false;
    }
}
