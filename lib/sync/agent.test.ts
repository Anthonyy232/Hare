import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

vi.mock('../media/safe-media', () => ({
  safeMedia: {
    getCurrentTime: (media: HTMLMediaElement) => media.currentTime,
    setCurrentTime: (media: HTMLMediaElement, value: number) => { media.currentTime = value; },
    getPlaybackRate: (media: HTMLMediaElement) => media.playbackRate,
    setPlaybackRate: (media: HTMLMediaElement, value: number) => { media.playbackRate = value; },
    play: (media: HTMLMediaElement) => {
      (media as any)._paused = false;
      return Promise.resolve<void>(undefined);
    },
    pause: (media: HTMLMediaElement) => {
      (media as any)._paused = true;
    },
  },
}));

import { safeMedia } from '../media/safe-media';
import { SyncAgent, type SyncedController } from './agent';
import type { SyncEventPayload } from './types';
import { clampSpeed } from '../speed';

// Happy DOM omits these native HTMLMediaElement constants.
Object.assign(HTMLMediaElement, { HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3, HAVE_ENOUGH_DATA: 4 });

function createMockVideo(currentTime = 0, paused = true): HTMLVideoElement {
  const video = document.createElement('video');
  let _currentTime = currentTime;
  let _playbackRate = 1.0;
  (video as any)._paused = paused;

  Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_ENOUGH_DATA, configurable: true });
  Object.defineProperty(video, 'currentTime', {
    get: () => _currentTime,
    set: (v: number) => { _currentTime = v; },
    configurable: true,
  });
  Object.defineProperty(video, 'paused', {
    get: () => (video as any)._paused,
    configurable: true,
  });
  Object.defineProperty(video, 'playbackRate', {
    get: () => _playbackRate,
    set: (v: number) => { _playbackRate = v; },
    configurable: true,
  });
  return video;
}

function createController(video: HTMLVideoElement, speed = 1): SyncedController {
  let listener: ((speed: number) => void) | null = null;
  return {
    media: video,
    get intendedSpeed() { return speed; },
    setSpeed(next) { speed = clampSpeed(next); video.playbackRate = speed; listener?.(speed); },
    applyTransientRate(rate) { video.playbackRate = rate; },
    setIntendedSpeedListener(next) { listener = next; },
  };
}

describe('SyncAgent', () => {
  let video: HTMLVideoElement;
  let sendEvent: ReturnType<typeof vi.fn<(event: SyncEventPayload) => void>>;
  let controller: SyncedController;
  let agent: SyncAgent;

  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    video = createMockVideo(10);
    sendEvent = vi.fn();
    controller = createController(video);
    agent = new SyncAgent(controller, sendEvent);
  });

  afterEach(() => {
    agent.destroy();
  });

  it('reports readiness while buffering media is paused by its peer', () => {
    (video as any)._paused = false;
    video.dispatchEvent(new Event('waiting'));
    video.dispatchEvent(new Event('waiting'));
    agent.pause(undefined, true);
    video.dispatchEvent(new Event('pause'));
    video.dispatchEvent(new Event('canplay'));
    video.dispatchEvent(new Event('playing'));
    expect(sendEvent.mock.calls.map(([event]) => event.action)).toEqual(['buffering_start', 'buffering_end']);
  });

  it('clears buffering after a deliberate remote pause without reporting recovery', () => {
    (video as any)._paused = false;
    video.dispatchEvent(new Event('waiting'));
    sendEvent.mockClear();
    agent.pause(undefined, false);
    video.dispatchEvent(new Event('pause'));
    video.dispatchEvent(new Event('canplay'));
    expect(agent.getPosition().buffering).toBe(false);
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('ignores network stalls while enough media remains buffered', () => {
    (video as any)._paused = false;
    video.dispatchEvent(new Event('stalled'));
    expect(sendEvent).not.toHaveBeenCalled();
    Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_CURRENT_DATA });
    video.dispatchEvent(new Event('stalled'));
    expect(sendEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'buffering_start' }));
  });

  it('does not turn a superseded play rejection into a user pause', async () => {
    const pending = Promise.withResolvers<void>();
    const play = vi.spyOn(safeMedia, 'play').mockImplementationOnce(media => {
      (media as any)._paused = false;
      return pending.promise;
    });
    const started = agent.play();
    video.dispatchEvent(new Event('play'));
    agent.pause(undefined, false);
    video.dispatchEvent(new Event('pause'));
    await agent.play();
    video.dispatchEvent(new Event('play'));
    pending.reject(new DOMException('Interrupted by pause', 'AbortError'));
    expect(await started).toBe(false);
    expect(sendEvent).not.toHaveBeenCalled();
    play.mockRestore();
  });

  it('reports an actual play rejection and leaves later user play observable', async () => {
    const play = vi.spyOn(safeMedia, 'play').mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'));
    expect(await agent.play()).toBe(false);
    video.dispatchEvent(new Event('play'));
    expect(sendEvent.mock.calls.map(([event]) => event.action)).toEqual(['pause', 'play']);
    play.mockRestore();
  });

  it('does not swallow a user seek after remote seeks coalesce', () => {
    agent.seek({ position: 20, tolerance: 0 });
    agent.seek({ position: 30, tolerance: 0 });
    video.dispatchEvent(new Event('seeked'));
    video.currentTime = 40;
    video.dispatchEvent(new Event('seeked'));
    vi.advanceTimersByTime(60);
    expect(sendEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'seek', position: 40 }));
  });

  it('leaves user pause observable after a no-op remote pause', () => {
    agent.pause(undefined, false);
    video.dispatchEvent(new Event('pause'));
    expect(sendEvent).toHaveBeenCalledTimes(1);
  });

  it('leaves user play observable after a no-op remote play', () => {
    (video as any)._paused = false;
    agent.play();
    video.dispatchEvent(new Event('play'));
    expect(sendEvent).toHaveBeenCalledTimes(1);
  });

  describe('coordinator-issued play buffering behavior', () => {

    it('reports real buffering during coordinator-initiated play', () => {
      agent.play();
      video.dispatchEvent(new Event('play'));

      video.dispatchEvent(new Event('waiting'));
      expect(sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'buffering_start' })
      );

      video.dispatchEvent(new Event('playing'));
      expect(sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'buffering_end' })
      );
    });

    it('reports a peer-requested seek as buffering until it lands', () => {
      (video as any)._paused = false;
      Object.defineProperty(video, 'seeking', { value: true, configurable: true });
      agent.seek({ position: 50, tolerance: 0 });
      agent.pause(undefined, true);
      video.dispatchEvent(new Event('pause'));
      video.dispatchEvent(new Event('waiting'));
      Object.defineProperty(video, 'seeking', { value: false, configurable: true });
      video.dispatchEvent(new Event('seeked'));
      video.dispatchEvent(new Event('canplay'));
      vi.advanceTimersByTime(60);
      expect(sendEvent.mock.calls.map(([event]) => event.action)).toEqual(['buffering_start', 'buffering_end']);
    });


    it('ignores waiting after a remote pause', () => {
      agent.play();

      agent.pause(undefined, false);

      video.dispatchEvent(new Event('pause'));
      video.dispatchEvent(new Event('waiting'));
      expect(sendEvent).not.toHaveBeenCalled();
    });
  });

  it('restores the rate and cancels pending work on destroy', () => {
    agent.correctRate(0.05, 1000);
    video.dispatchEvent(new Event('seeked'));
    agent.destroy();
    expect(video.playbackRate).toBe(1);
    for (const type of ['play', 'pause', 'seeking', 'seeked', 'waiting', 'stalled', 'playing']) {
      video.dispatchEvent(new Event(type));
    }
    vi.advanceTimersByTime(2000);
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('debounces rapid seeks (scrubbing)', () => {
    video.dispatchEvent(new Event('seeked'));
    video.dispatchEvent(new Event('seeked'));
    video.dispatchEvent(new Event('seeked'));

    expect(sendEvent).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60);

    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'seek' })
    );
  });

  it('does not let a no-op coordinator seek swallow the next user seek', () => {
    agent.seek({ position: 10, tolerance: 0 }); // Already at 10, so no seeked event follows.

    video.currentTime = 10.01;
    video.dispatchEvent(new Event('seeked'));
    vi.advanceTimersByTime(60);

    expect(sendEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'seek', position: 10.01 }));
  });

  it('skips a seek the media is already within tolerance of', () => {
    agent.seek({ position: 10.04, tolerance: 0.05 });
    expect(video.currentTime).toBe(10);
    agent.seek({ position: 10.06, tolerance: 0.05 });
    expect(video.currentTime).toBe(10.06);
  });

  it('emitted events carry the source rate', () => {
    video.playbackRate = 1.25;
    video.dispatchEvent(new Event('pause'));
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'pause', rate: 1.25 })
    );
  });

  describe('rate propagation', () => {
    it('reports a speed the user chooses and corrects drift around it', () => {
      controller.setSpeed(1.5);
      expect(sendEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'ratechange', rate: 1.5 }));
      agent.correctRate(0.02, 1000);
      expect(video.playbackRate).toBeCloseTo(1.52, 5);
    });

    it.each([[1.5, 1.5], [0.875, 0.88]])('does not echo a speed of %s that sync applied', (rate, shown) => {
      expect(agent.setRate(rate)).toBe(true);
      expect(video.playbackRate).toBe(shown);
      expect(sendEvent).not.toHaveBeenCalled();
    });

    it('fails a speed beyond what the browser plays', () => {
      expect(agent.setRate(20)).toBe(false);
      expect(sendEvent).not.toHaveBeenCalled();
    });

    it('corrects drift around a speed that sync applied', () => {
      agent.setRate(2);
      agent.correctRate(0.05, 1000);
      expect(video.playbackRate).toBeCloseTo(2.05, 5);
    });

    it('temporarily adjusts playback without changing the intended speed', () => {
      agent.correctRate(0.02, 1000);
      expect(video.playbackRate).toBe(1.02);
      expect(controller.intendedSpeed).toBe(1);
      vi.advanceTimersByTime(1000);
      expect(video.playbackRate).toBe(1);
      expect(controller.intendedSpeed).toBe(1);
      expect(sendEvent).not.toHaveBeenCalled();
    });
  });
});
