import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { MEDIA_VALIDATION } from '../constants';
import { matchesDomains } from './utils';

export class YouTubeHandler extends BaseSiteHandler {
  private static readonly DOMAINS = ['youtube.com', 'youtu.be'] as const;

  matches(): boolean {
    return matchesDomains(YouTubeHandler.DOMAINS);
  }

  getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
    const player = video.closest('.html5-video-player');
    if (player) {
      return { target: player, method: 'prepend' };
    }

    const container = video.closest('.html5-video-container');
    if (container) {
      return { target: container, method: 'prepend' };
    }

    const grandparent = video.parentElement?.parentElement;
    if (grandparent) {
      return { target: grandparent, method: 'prepend' };
    }

    return null;
  }

  shouldIgnoreVideo(video: HTMLVideoElement): boolean {
    if (video.closest('.ytp-ad-player-overlay, .ytp-ad-module')) return true;
    if (video.closest('ytd-shorts, ytd-reel-video-renderer')) return true;
    if (video.closest('ytmusic-player-bar, .ytmusic-player-bar')) return true;
    if (video.closest('#channel-header-container')) return true;
    if (video.closest('#video-preview, ytd-video-preview')) return true;

    if (
      video.offsetWidth < MEDIA_VALIDATION.MIN_WIDTH ||
      video.offsetHeight < MEDIA_VALIDATION.MIN_HEIGHT
    ) {
      return true;
    }

    return false;
  }
}
