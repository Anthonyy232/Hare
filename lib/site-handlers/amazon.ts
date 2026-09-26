import { BaseSiteHandler } from './base';
import type { ControllerPosition } from '../types';
import { MEDIA_VALIDATION } from '../constants';
import { matchesDomains } from './utils';

export class AmazonHandler extends BaseSiteHandler {
  private static readonly DOMAINS = [
    'primevideo.com', 'amazon.com', 'amazon.co.uk', 'amazon.de',
    'amazon.fr', 'amazon.es', 'amazon.it', 'amazon.co.jp',
    'amazon.in', 'amazon.com.br', 'amazon.com.mx', 'amazon.com.au',
    'amazon.nl', 'amazon.se', 'amazon.pl', 'amazon.sg',
    'amazon.ae', 'amazon.sa', 'amazon.eg', 'amazon.ca',
  ] as const;

  matches(): boolean {
    return matchesDomains(AmazonHandler.DOMAINS);
  }

  getControllerPosition(video: HTMLVideoElement): ControllerPosition | null {
    const container = video.closest('.vjs-tech')?.parentElement || video.closest('.webPlayerContainer');
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
      video.offsetWidth < MEDIA_VALIDATION.MIN_WIDTH * 2 ||
      video.offsetHeight < MEDIA_VALIDATION.MIN_HEIGHT
    ) {
      return true;
    }

    if (video.closest('.a-image-wrapper, .imageBlock')) {
      return true;
    }

    return false;
  }
}
