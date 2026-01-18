import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { MEDIA_VALIDATION } from '../constants';
import { matchesDomains } from './utils';

export class NetflixHandler extends BaseSiteHandler {
  private static readonly DOMAINS = ['netflix.com'] as const;

  matches(): boolean {
    return matchesDomains(NetflixHandler.DOMAINS);
  }

  getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
    const container = video.closest('.watch-video--player-view') || video.closest('.NFPlayer');
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
   * Filters out billboard ads, hover previews, and 'More Like This' thumbnails
   * to ensure the controller only attaches to the primary player.
   */
  shouldIgnoreVideo(video: HTMLVideoElement): boolean {
    if (
      video.closest('.billboard-row') ||
      video.closest('.jawBone') ||
      video.closest('[data-uia="billboard"]') ||
      video.closest('[data-uia="hero-billboard"]') ||
      video.classList.contains('preview-video') ||
      video.closest('.moreLikeThis') ||
      video.closest('[data-uia="more-like-this"]') ||
      video.closest('.title-card') ||
      video.closest('.slider-item')
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
