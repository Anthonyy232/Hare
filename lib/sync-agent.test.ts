import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

vi.mock('./safe-media', () => ({
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

import { safeMedia } from './safe-media';
import { SyncAgent } from './sync-agent';
import type { SyncEventPayload } from './sync-types';

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

describe('SyncAgent', () => {
  let video: HTMLVideoElement;
  let sendEvent: ReturnType<typeof vi.fn<(event: SyncEventPayload) => void>>;
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
    agent = new SyncAgent(video, sendEvent);
  });

  afterEach(() => {
    agent.destroy();
  });

  it('reports readiness while buffering media is paused by its peer', () => {
    (video as any)._paused = false;
    video.dispatchEvent(new Event('waiting'));
    video.dispatchEvent(new Event('waiting'));
    agent.executePause(true);
    video.dispatchEvent(new Event('pause'));
    video.dispatchEvent(new Event('canplay'));
    video.dispatchEvent(new Event('playing'));
    expect(sendEvent.mock.calls.map(([event]) => event.action)).toEqual(['buffering_start', 'buffering_end']);
  });

  it('clears buffering after a deliberate remote pause without reporting recovery', () => {
    (video as any)._paused = false;
    video.dispatchEvent(new Event('waiting'));
    sendEvent.mockClear();
    agent.executePause();
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
    const started = agent.executePlay();
    video.dispatchEvent(new Event('play'));
    agent.executePause();
    video.dispatchEvent(new Event('pause'));
    await agent.executePlay();
    video.dispatchEvent(new Event('play'));
    pending.reject(new DOMException('Interrupted by pause', 'AbortError'));
    expect(await started).toBe(false);
    expect(sendEvent).not.toHaveBeenCalled();
    play.mockRestore();
  });

  it('reports an actual play rejection and leaves later user play observable', async () => {
    const play = vi.spyOn(safeMedia, 'play').mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'));
    expect(await agent.executePlay()).toBe(false);
    video.dispatchEvent(new Event('play'));
    expect(sendEvent.mock.calls.map(([event]) => event.action)).toEqual(['pause', 'play']);
    play.mockRestore();
  });

  it('does not swallow a user seek after remote seeks coalesce', () => {
    agent.executeSeek(20);
    agent.executeSeek(30);
    video.dispatchEvent(new Event('seeked'));
    video.currentTime = 40;
    video.dispatchEvent(new Event('seeked'));
    vi.advanceTimersByTime(60);
    expect(sendEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'seek', position: 40 }));
  });

  it('leaves user pause observable after a no-op remote pause', () => {
    agent.executePause();
    video.dispatchEvent(new Event('pause'));
    expect(sendEvent).toHaveBeenCalledTimes(1);
  });

  it('leaves user play observable after a no-op remote play', () => {
    (video as any)._paused = false;
    agent.executePlay();
    video.dispatchEvent(new Event('play'));
    expect(sendEvent).toHaveBeenCalledTimes(1);
  });

  describe('coordinator-issued play buffering behavior', () => {
    it('suppresses playing when coordinator-initiated play starts cleanly', () => {
      agent.executePlay();
      video.dispatchEvent(new Event('play'));
      video.dispatchEvent(new Event('playing'));

      expect(sendEvent).not.toHaveBeenCalled();
    });

    it('reports real buffering during coordinator-initiated play', () => {
      agent.executePlay();
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

    it('does not suppress buffering when play was user-initiated', () => {
      (video as any)._paused = false;
      video.dispatchEvent(new Event('play'));
      expect(sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'play' })
      );

      video.dispatchEvent(new Event('waiting'));
      expect(sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'buffering_start' })
      );

      video.dispatchEvent(new Event('playing'));
      expect(sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'buffering_end' })
      );
    });

    it('reports starvation during a remote seek and recovery while paused', () => {
      (video as any)._paused = false;
      agent.executeSeek(50);
      video.dispatchEvent(new Event('seeking'));
      video.dispatchEvent(new Event('waiting'));
      agent.executePause(true);
      video.dispatchEvent(new Event('pause'));
      video.dispatchEvent(new Event('seeked'));
      video.dispatchEvent(new Event('canplay'));
      vi.advanceTimersByTime(60);
      expect(sendEvent.mock.calls.map(([event]) => event.action)).toEqual(['buffering_start', 'buffering_end']);
    });

    it('ignores waiting from an already paused user seek', () => {
      video.dispatchEvent(new Event('seeking'));
      video.dispatchEvent(new Event('waiting'));
      video.dispatchEvent(new Event('seeked'));
      vi.advanceTimersByTime(60);
      expect(sendEvent.mock.calls.map(([event]) => event.action)).toEqual(['seek']);
    });

    it('ignores waiting after a remote pause', () => {
      agent.executePlay();

      agent.executePause();

      video.dispatchEvent(new Event('pause'));
      video.dispatchEvent(new Event('waiting'));
      expect(sendEvent).not.toHaveBeenCalled();
    });
  });

  it('restores the rate and cancels pending work on destroy', () => {
    agent.applyRateCorrection(0.05, 1000);
    video.dispatchEvent(new Event('seeked'));
    agent.destroy();
    expect(video.playbackRate).toBe(1);
    for (const type of ['play', 'pause', 'seeking', 'seeked', 'waiting', 'stalled', 'playing']) {
      video.dispatchEvent(new Event(type));
    }
    expect(vi.getTimerCount()).toBe(0);
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
    agent.executeSeek(10); // already at 10, so no seeked event is expected

    video.currentTime = 20;
    video.dispatchEvent(new Event('seeked'));
    vi.advanceTimersByTime(60);

    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'seek', position: 20 })
    );
  });

  it('emitted events carry the source rate', () => {
    video.playbackRate = 1.25;
    video.dispatchEvent(new Event('pause'));
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'pause', rate: 1.25 })
    );
  });

  describe('rate propagation', () => {

    it('propagates intended speed changes and updates the rate-correction base', () => {
      agent.notifyIntendedSpeedChange(1.5);
      expect(sendEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ action: 'ratechange', rate: 1.5 })
      );
      agent.applyRateCorrection(0.02, 1000);
      expect(video.playbackRate).toBeCloseTo(1.52, 5);
    });

    it('executeRateChange suppresses the echo from notifyIntendedSpeedChange', () => {

      const peer = new SyncAgent(
        video,
        sendEvent,
        1.0,
        (rate: number) => {
          peer.notifyIntendedSpeedChange(rate);
          video.playbackRate = rate;
        }
      );
      peer.executeRateChange(1.5);
      expect(sendEvent).not.toHaveBeenCalled();
      peer.destroy();
    });

    it('executeRateChange updates the rate-correction base', () => {
      agent.executeRateChange(2.0);
      agent.applyRateCorrection(0.05, 1000);
      expect(video.playbackRate).toBeCloseTo(2.05, 5);
    });

    it('applyRateCorrection uses the transient rate path', () => {
      const peerVideo = createMockVideo(10);
      const setIntendedSpeed = vi.fn((rate: number) => {
        peerVideo.playbackRate = rate;
      });
      const setTransientRate = vi.fn((rate: number) => {
        peerVideo.playbackRate = rate;
      });
      const peer = new SyncAgent(
        peerVideo,
        sendEvent,
        1.0,
        setIntendedSpeed,
        setTransientRate
      );

      peer.applyRateCorrection(0.02, 1000);
      expect(setTransientRate).toHaveBeenCalledWith(1.02);
      expect(setIntendedSpeed).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(setTransientRate).toHaveBeenLastCalledWith(1.0);
      peer.destroy();
    });
  });
});
