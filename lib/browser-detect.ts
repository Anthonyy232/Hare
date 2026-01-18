/**
 * Cross-browser feature detection utilities.
 * Provides runtime feature detection for defensive coding.
 */

/**
 * Runtime feature detection for browser-specific APIs and quirks
 */
export const BrowserFeatures = {
  /**
   * Check if PointerEvent API is available
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
   */
  hasPointerEvents: typeof PointerEvent !== 'undefined',

  /**
   * Check if ResizeObserver is available
   * @see https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
   */
  hasResizeObserver: typeof ResizeObserver !== 'undefined',

  /**
   * Check if requestIdleCallback is available
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback
   */
  hasRequestIdleCallback: typeof requestIdleCallback === 'function',

  /**
   * Check if adoptedStyleSheets is supported (Constructable Stylesheets)
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptedStyleSheets
   */
  hasAdoptedStyleSheets: (() => {
    try {
      return 'adoptedStyleSheets' in Document.prototype;
    } catch {
      return false;
    }
  })(),
} as const;

/**
 * Safely check if current window is the top frame
 * Firefox throws SecurityError when accessing window.top in cross-origin iframes
 *
 * @returns true if top frame, false if in iframe or cross-origin restriction
 */
export function isTopFrame(): boolean {
  try {
    return window === window.top;
  } catch {
    // SecurityError in cross-origin iframe (Firefox)
    return false;
  }
}
