export const BrowserFeatures = {
  hasResizeObserver: typeof ResizeObserver !== 'undefined',
  hasRequestIdleCallback: typeof requestIdleCallback === 'function',
} as const;
