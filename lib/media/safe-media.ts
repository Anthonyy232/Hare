import { clamp } from '../math';

/** Media accessors that sites can't intercept by overriding properties on the element. */

const mediaProto = HTMLMediaElement.prototype;

const currentTimeDescriptor = Object.getOwnPropertyDescriptor(mediaProto, 'currentTime')!;
const playbackRateDescriptor = Object.getOwnPropertyDescriptor(mediaProto, 'playbackRate')!;
// Called with .call on each element, so they never rely on a bound this.
// oxlint-disable-next-line typescript/unbound-method
const playMethod = mediaProto.play;
// oxlint-disable-next-line typescript/unbound-method
const pauseMethod = mediaProto.pause;

export function clampSeekTime(media: HTMLMediaElement, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Seek position must be finite');
  const ranges = media.seekable;
  if (ranges.length) {
    let closest = ranges.start(0);
    for (let i = 0; i < ranges.length; i++) {
      const start = ranges.start(i);
      const end = ranges.end(i);
      if (value >= start && value <= end) return value;
      for (const boundary of [start, end]) {
        if (Math.abs(value - boundary) < Math.abs(value - closest)) closest = boundary;
      }
    }
    return closest;
  }
  return clamp(value, 0, Number.isFinite(media.duration) ? media.duration : Infinity);
}

export const safeMedia = {
  getCurrentTime(media: HTMLMediaElement): number {
    return currentTimeDescriptor.get!.call(media) as number;
  },

  setCurrentTime(media: HTMLMediaElement, value: number): void {
    currentTimeDescriptor.set!.call(media, clampSeekTime(media, value));
  },

  getPlaybackRate(media: HTMLMediaElement): number {
    return playbackRateDescriptor.get!.call(media) as number;
  },

  setPlaybackRate(media: HTMLMediaElement, value: number): void {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Playback speed must be a positive finite number');
    playbackRateDescriptor.set!.call(media, value);
  },

  play(media: HTMLMediaElement): Promise<void> {
    return playMethod.call(media);
  },

  pause(media: HTMLMediaElement): void {
    pauseMethod.call(media);
  },
};
