/**
 * Cross-browser utility for accessing Shadow DOMs, including closed shadow roots.
 * Uses the extension-specific APIs (chrome.dom / browser.dom) when available,
 * falling back to the standard element.shadowRoot for open shadows.
 */

import { logger } from './logger';

/**
 * Retrieves the shadow root of an element, including closed shadow roots when
 * the extension API is available.
 *
 * - Chrome 88+: `chrome.dom.openOrClosedShadowRoot()`
 * - Firefox: `browser.dom.openOrClosedShadowRoot()` (via WXT's `browser` global)
 * - Fallback: `element.shadowRoot` (open shadows only)
 */
export function getShadowRoot(element: Element): ShadowRoot | null {
    // Try Chrome API (globalThis.chrome is provided by extension environment)
    const chromeGlobal = globalThis as typeof globalThis & {
        chrome?: { dom?: { openOrClosedShadowRoot?: (el: Element) => ShadowRoot | null } };
    };
    if (chromeGlobal.chrome?.dom?.openOrClosedShadowRoot) {
        try {
            return chromeGlobal.chrome.dom.openOrClosedShadowRoot(element);
        } catch (error) {
            // API may throw if element is detached or cross-origin
            logger.debug('Chrome shadow root API failed (element may be detached or cross-origin):', error);
        }
    }

    // Try Firefox API (WXT maps this to `browser` global)
    const browserGlobal = globalThis as typeof globalThis & {
        browser?: { dom?: { openOrClosedShadowRoot?: (el: Element) => ShadowRoot | null } };
    };
    if (browserGlobal.browser?.dom?.openOrClosedShadowRoot) {
        try {
            return browserGlobal.browser.dom.openOrClosedShadowRoot(element);
        } catch (error) {
            // Same fallback behavior
            logger.debug('Firefox shadow root API failed (element may be detached or cross-origin):', error);
        }
    }

    // Standard fallback for open shadow roots
    return element.shadowRoot;
}
