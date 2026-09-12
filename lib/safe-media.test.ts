import { describe, it, expect } from 'vitest';
import { clampSeekTime, safeMedia } from './safe-media';

describe('media boundaries', () => {
  it('clamps VOD seeks to duration and zero', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { value: 30 });
    expect(clampSeekTime(video, -10)).toBe(0);
    expect(clampSeekTime(video, 99)).toBe(30);
  });
  it('clamps live media and gaps to the nearest seekable range', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { value: Infinity });
    Object.defineProperty(video, 'seekable', { value: { length: 2, start: (i: number) => [100, 130][i], end: (i: number) => [110, 150][i] } });
    expect(clampSeekTime(video, 0)).toBe(100);
    expect(clampSeekTime(video, 115)).toBe(110);
    expect(clampSeekTime(video, 125)).toBe(130);
    expect(clampSeekTime(video, 500)).toBe(150);
    expect(clampSeekTime(video, 140)).toBe(140);
  });
  it.each([NaN, Infinity, -Infinity])('rejects a non-finite seek or speed: %s', value => {
    const video = document.createElement('video');
    expect(() => safeMedia.setCurrentTime(video, value)).toThrow();
    expect(() => safeMedia.setPlaybackRate(video, value)).toThrow();
  });
});
