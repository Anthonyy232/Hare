import { browser } from 'wxt/browser';
import { logger } from '../logger';
import { CONTROLLER_TAG } from './controller-view';

export function getShadowRoot(element: Element): ShadowRoot | null {
  if (browser?.dom?.openOrClosedShadowRoot && element instanceof HTMLElement) {
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
  const stack: Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node instanceof Element) {
      if (node.localName === CONTROLLER_TAG) continue;
      if (node instanceof HTMLVideoElement || (includeAudio && node instanceof HTMLAudioElement)) media.push(node);
      const shadow = getShadowRoot(node);
      if (shadow) {
        onShadow?.(shadow);
        stack.push(shadow);
      }
    }
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes[i];
      if (child instanceof Element) stack.push(child);
    }
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
