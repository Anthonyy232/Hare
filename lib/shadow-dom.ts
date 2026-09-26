import { browser } from 'wxt/browser';
import { logger } from './logger';

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
