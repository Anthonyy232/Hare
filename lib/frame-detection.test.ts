import { describe, it, expect } from 'vitest';

describe('Cross-origin frame detection', () => {
  it('safely detects top frame with try-catch pattern', () => {
    // Verify our defensive coding pattern doesn't throw
    let isTop = false;

    expect(() => {
      try {
        isTop = window === window.top;
      } catch {
        isTop = false;
      }
    }).not.toThrow();

    // In test environment, should be top frame
    expect(isTop).toBe(true);
  });
});
