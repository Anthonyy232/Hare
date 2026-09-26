/**
 * Safe accessors that bypass instance-level property overrides.
 * Uses prototype methods directly to avoid site tampering.
 */

const mediaProto = HTMLMediaElement.prototype;

const currentTimeDescriptor = Object.getOwnPropertyDescriptor(mediaProto, 'currentTime')!;
const playbackRateDescriptor = Object.getOwnPropertyDescriptor(mediaProto, 'playbackRate')!;
const playMethod = mediaProto.play;
const pauseMethod = mediaProto.pause;

/** Clamp VOD seeks and live/DVR seeks to the nearest available range. */
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
    return Math.max(0, Number.isFinite(media.duration) ? Math.min(media.duration, value) : value);
}

export const safeMedia = {
    getCurrentTime(media: HTMLMediaElement): number {
        return currentTimeDescriptor.get!.call(media);
    },

    setCurrentTime(media: HTMLMediaElement, value: number): void {
        currentTimeDescriptor.set!.call(media, clampSeekTime(media, value));
    },

    getPlaybackRate(media: HTMLMediaElement): number {
        return playbackRateDescriptor.get!.call(media);
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
