import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { MEDIA_VALIDATION } from '../constants';
import { matchesDomains } from './utils';

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

    shouldIgnoreVideo(video: HTMLVideoElement): boolean {
        if (
            video.closest('[data-testid="trailer-player"], .HeroPlayer, [class*="Preview"]')
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
