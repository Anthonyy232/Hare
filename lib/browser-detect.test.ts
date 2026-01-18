import { describe, it, expect } from 'vitest';
import { BrowserFeatures, isTopFrame } from './browser-detect';

describe('BrowserFeatures', () => {
  it('detects PointerEvent support', () => {
    expect(typeof BrowserFeatures.hasPointerEvents).toBe('boolean');
  });

  it('detects ResizeObserver support', () => {
    expect(typeof BrowserFeatures.hasResizeObserver).toBe('boolean');
  });

  it('detects requestIdleCallback support', () => {
    expect(typeof BrowserFeatures.hasRequestIdleCallback).toBe('boolean');
  });

  it('detects adoptedStyleSheets support', () => {
    expect(typeof BrowserFeatures.hasAdoptedStyleSheets).toBe('boolean');
  });
});

describe('isTopFrame', () => {
  it('safely detects top frame without throwing', () => {
    expect(() => isTopFrame()).not.toThrow();
  });

  it('returns boolean', () => {
    expect(typeof isTopFrame()).toBe('boolean');
  });

  it('returns true in test environment (top frame)', () => {
    expect(isTopFrame()).toBe(true);
  });
});
