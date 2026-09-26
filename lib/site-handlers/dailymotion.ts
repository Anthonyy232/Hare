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

    shouldIgnoreVideo(video: HTMLVideoElement): boolean {
        if (
            video.closest('.sidebar, .video__suggestion, .ad-container, [class*="ad-"]')
        ) {
            return true;
        }

        if (video.offsetWidth < 200 || video.offsetHeight < 150) return true;

        return false;
    }
}
