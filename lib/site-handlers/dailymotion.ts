import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { matchesDomains } from './utils';

export class DailymotionHandler extends BaseSiteHandler {
    private static readonly DOMAINS = ['dailymotion.com'] as const;

    matches(): boolean {
        return matchesDomains(DailymotionHandler.DOMAINS);
    }

    getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
        const container =
            video.closest('#player-wrapper') ||
            video.closest('.dmp_Player') ||
            video.closest('.video-container');

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
     * Filters out sidebar suggestions and ad-related containers.
     */
    shouldIgnoreVideo(video: HTMLVideoElement): boolean {
        if (
            video.closest('.sidebar') ||
            video.closest('.video__suggestion') ||
            video.closest('.ad-container') ||
            video.closest('[class*="ad-"]')
        ) {
            return true;
        }

        if (video.offsetWidth < 200 || video.offsetHeight < 150) return true;

        return false;
    }
}
