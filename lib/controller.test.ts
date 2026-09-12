import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { VideoController } from './controller';
import { DEFAULT_SETTINGS } from './types';
import { safeMedia } from './safe-media';
import { BaseSiteHandler } from './site-handlers/base';

describe('controller', () => {
  let video: HTMLVideoElement;
  let controller: VideoController;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div><video></video></div>';
    video = document.querySelector('video')!;
    controller = new VideoController(video, structuredClone(DEFAULT_SETTINGS), new BaseSiteHandler());
  });
  afterEach(() => { controller.destroy(); vi.restoreAllMocks(); vi.useRealTimers(); });
  it('does not throw or notify sync when a player rejects a rate', () => {
    const listener = vi.fn(); controller.setIntendedSpeedListener(listener);
    vi.spyOn(safeMedia, 'setPlaybackRate').mockImplementation(() => { throw new Error('Unsupported speed'); });
    expect(controller.setSpeed(0.07)).toBe(false);
    expect(controller.intendedSpeed).toBe(1);
    expect(listener).not.toHaveBeenCalled();
    expect(document.querySelector('hare-controller')!.shadowRoot!.querySelector('.hare-osd')!.textContent).toBe('Speed control blocked');
  });
  it('does not resume after a deliberate pause', async () => {
    const play = vi.spyOn(safeMedia, 'play');
    controller.setSpeed(1.5);
    video.dispatchEvent(new Event('pause'));
    await vi.advanceTimersByTimeAsync(600);
    expect(play).not.toHaveBeenCalled();
  });
  it('cleans up listeners, timers, and late feedback', async () => {
    const callback = vi.fn(); controller.setIntendedSpeedListener(callback);
    controller.setSpeed(2);
    controller.destroy();
    await vi.advanceTimersByTimeAsync(6000);
    expect(document.querySelector('hare-controller')).toBeNull();
    expect(controller.setSpeed(3)).toBe(false);
    expect(callback).toHaveBeenCalledTimes(1);
  });
  it('does not mount inside a video matching a player selector', () => {
    controller.destroy(); video.className = 'vjs-tech';
    controller = new VideoController(video, structuredClone(DEFAULT_SETTINGS), new BaseSiteHandler());
    expect(video.querySelector('hare-controller')).toBeNull();
    expect(video.parentElement!.querySelector('hare-controller')).not.toBeNull();
  });
  it('honors distinct forward/backward button steps', () => {
    controller.updateSettings({ ...DEFAULT_SETTINGS, keyBindings: DEFAULT_SETTINGS.keyBindings.map(binding => ({ ...binding, value: binding.action === 'slower' ? 0.25 : binding.value })) });
    document.querySelector('hare-controller')!.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="slower"]')!.click();
    expect(controller.speed).toBe(0.75);
  });
  it('restores shared parent styles only after the last controller is removed', () => {
    controller.destroy();
    const parent = video.parentElement!;
    parent.style.position = 'static';
    controller = new VideoController(video, structuredClone(DEFAULT_SETTINGS));
    const secondVideo = document.createElement('video'); parent.append(secondVideo);
    const second = new VideoController(secondVideo, structuredClone(DEFAULT_SETTINGS));
    controller.destroy();
    expect(parent.style.position).toBe('relative');
    second.destroy();
    expect(parent.style.position).toBe('static');
  });
});
