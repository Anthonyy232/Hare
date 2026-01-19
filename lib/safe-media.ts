/**
 * Safe accessors that bypass instance-level property overrides.
 * Uses prototype methods directly to avoid site tampering.
 */

// We cache these at the earliest possible moment
const mediaProto = HTMLMediaElement.prototype;

const currentTimeDescriptor = Object.getOwnPropertyDescriptor(mediaProto, 'currentTime')!;
const playbackRateDescriptor = Object.getOwnPropertyDescriptor(mediaProto, 'playbackRate')!;
const playMethod = mediaProto.play;
const pauseMethod = mediaProto.pause;

export const safeMedia = {
    getCurrentTime(media: HTMLMediaElement): number {
        return currentTimeDescriptor.get!.call(media);
    },

    setCurrentTime(media: HTMLMediaElement, value: number): void {
        currentTimeDescriptor.set!.call(media, value);
    },

    getPlaybackRate(media: HTMLMediaElement): number {
        return playbackRateDescriptor.get!.call(media);
    },

    setPlaybackRate(media: HTMLMediaElement, value: number): void {
        playbackRateDescriptor.set!.call(media, value);
    },

    play(media: HTMLMediaElement): Promise<void> {
        return playMethod.call(media);
    },

    pause(media: HTMLMediaElement): void {
        pauseMethod.call(media);
    },
};
