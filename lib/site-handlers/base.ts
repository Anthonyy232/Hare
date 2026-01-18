import type { SiteHandler, ControllerPosition } from '../types';

/**
 * Catch-all handler for sites without custom logic. Uses common player class names
 * to guess the best mounting point for the controller.
 */
export class BaseSiteHandler implements SiteHandler {
  matches(): boolean {
    return true;
  }

  getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
    const selectors = [
      '.video-js', '.vjs-tech', '.plyr', '.mejs-container',
      '.flowplayer', '.jw-wrapper', '.jwplayer', '.theoplayer-container',
      '.bitmovinplayer-container', '.video-container', '.player-container',
      '.player-wrapper', '.video-player', '.html5-video-player',
      '[data-player]', '[data-testid*="player"]', '[data-testid*="video"]',
    ];

    for (const selector of selectors) {
      const container = video.closest(selector);
      if (container) {
        return { target: container, method: 'prepend' };
      }
    }

    const parent = video.parentElement;
    if (parent && getComputedStyle(parent).position !== 'static') {
      return { target: parent, method: 'prepend' };
    }

    return null;
  }

  shouldIgnoreVideo(_video: HTMLVideoElement): boolean {
    return false;
  }
}
