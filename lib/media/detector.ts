import { browser } from 'wxt/browser';
import { logger } from '../logger';
import { CONTROLLER_TAG } from './controller-view';

export function getShadowRoot(element: Element): ShadowRoot | null {
  if (browser.dom?.openOrClosedShadowRoot && element instanceof HTMLElement) {
    try {
      return browser.dom.openOrClosedShadowRoot(element);
    } catch (error) {
      logger.debug('Extension shadow root API failed:', error);
    }
  }

  // Firefox exposes closed roots as an element property in content scripts.
  if ('openOrClosedShadowRoot' in element) {
    return (element as Element & { openOrClosedShadowRoot: ShadowRoot | null }).openOrClosedShadowRoot;
  }
  return element.shadowRoot;
}

export function scanMediaTree(
  root: Node,
  includeAudio: boolean,
  onShadow?: (shadow: ShadowRoot) => void,
): HTMLMediaElement[] {
  const media: HTMLMediaElement[] = [];
  const roots: Node[] = [root];
  const visit = (element: Element): void => {
    if (element.localName === CONTROLLER_TAG) return;
    if (element instanceof HTMLVideoElement || (includeAudio && element instanceof HTMLAudioElement)) media.push(element);
    const shadow = getShadowRoot(element);
    if (shadow) {
      onShadow?.(shadow);
      roots.push(shadow);
    }
  };
  while (roots.length) {
    const current = roots.pop()!;
    if (current instanceof Element) visit(current);
    // text and comment nodes can't be queried
    if ('querySelectorAll' in current) (current as ParentNode).querySelectorAll('*').forEach(visit);
  }
  return media;
}

/** The media a user most likely means: playing before paused, then the largest. */
export function primaryMedia<T extends { media: HTMLMediaElement }>(items: T[]): T | undefined {
  const area = (media: HTMLMediaElement) => {
    const rect = media.getBoundingClientRect();
    return rect.width * rect.height;
  };
  return items.toSorted((a, b) => Number(a.media.paused) - Number(b.media.paused) || area(b.media) - area(a.media))[0];
}
