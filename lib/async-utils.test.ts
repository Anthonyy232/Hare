import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './async-utils';

describe('bounded requests', () => {
  afterEach(() => vi.useRealTimers());
  it('clears the timer after a successful request', async () => {
    vi.useFakeTimers();
    expect(await withTimeout(Promise.resolve(42))).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out a frame that never responds', async () => {
    vi.useFakeTimers();
    const result = expect(withTimeout(new Promise(() => {}), 100)).rejects.toThrow('did not respond');
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
