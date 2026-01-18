/**
 * Cross-browser utility for accessing Shadow DOMs, including closed shadow roots.
 * Uses the extension-specific APIs (chrome.dom / browser.dom) when available,
 * falling back to the standard element.shadowRoot for open shadows.
 */

import { logger } from './logger';

/**
 * Get shadow root (including closed shadow roots) with cross-browser support
 *
 * Fallback chain:
 * 1. Chrome extension API: chrome.dom.openOrClosedShadowRoot()
 * 2. Firefox extension API: browser.dom.openOrClosedShadowRoot()
 * 3. Firefox element property: element.openOrClosedShadowRoot
 * 4. Standard API (open shadows only): element.shadowRoot
 *
 * @param element - Element to get shadow root from
 * @returns ShadowRoot if found, null otherwise
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

    // Firefox also exposes this as a direct property on elements (available in content scripts)
    const elementWithFirefoxAPI = element as Element & {
        openOrClosedShadowRoot?: ShadowRoot | null;
    };
    if ('openOrClosedShadowRoot' in element) {
        return elementWithFirefoxAPI.openOrClosedShadowRoot ?? null;
    }

    // Standard fallback for open shadow roots
    return element.shadowRoot;
}
