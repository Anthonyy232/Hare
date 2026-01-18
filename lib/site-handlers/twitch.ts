import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { MEDIA_VALIDATION } from '../constants';
import { matchesDomains } from './utils';

export class TwitchHandler extends BaseSiteHandler {
    private static readonly DOMAINS = ['twitch.tv'] as const;

    matches(): boolean {
        return matchesDomains(TwitchHandler.DOMAINS);
    }

    getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
        const container =
            video.closest('[data-a-target="video-player"]') ||
            video.closest('.clips-player') ||
            video.closest('.video-player__container');

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
     * Filters out channel preview cards and offline indicator loops.
     */
    shouldIgnoreVideo(video: HTMLVideoElement): boolean {
        if (
            video.closest('[data-a-target="preview-card-image-link"]') ||
            video.closest('.preview-card-thumbnail') ||
            video.closest('.channel-status-indicator--offline')
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
