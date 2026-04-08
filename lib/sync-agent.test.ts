import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

// Mock safe-media before importing SyncAgent
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

import { SyncAgent } from './sync-agent';

function createMockVideo(currentTime = 0, paused = true): HTMLVideoElement {
  const video = document.createElement('video');
  let _currentTime = currentTime;
  (video as any)._paused = paused;

  Object.defineProperty(video, 'currentTime', {
    get: () => _currentTime,
    set: (v: number) => { _currentTime = v; },
    configurable: true,
  });
  Object.defineProperty(video, 'paused', {
    get: () => (video as any)._paused,
    configurable: true,
  });
  return video;
}

describe('SyncAgent', () => {
  let video: HTMLVideoElement;
  let sendEvent: ReturnType<typeof vi.fn>;
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

  it('reports user-initiated pause to coordinator', () => {
    video.dispatchEvent(new Event('pause'));
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'pause', position: 10 })
    );
  });

  it('does NOT report self-caused pause (echo prevention)', () => {
    // Video must be playing for executePause to expect a pause event
    (video as any)._paused = false;
    agent.executePause();
    video.dispatchEvent(new Event('pause'));
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('reports user-initiated play', () => {
    video.dispatchEvent(new Event('play'));
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'play' })
    );
  });

  it('does NOT report self-caused play (echo prevention)', () => {
    // Video is paused (default) so executePlay expects a play event
    agent.executePlay();
    video.dispatchEvent(new Event('play'));
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('reports user-initiated seek with absolute position', () => {
    video.dispatchEvent(new Event('seeked'));
    vi.advanceTimersByTime(50); // SEEK_DEBOUNCE_MS
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'seek', position: 10 })
    );
  });

  it('does NOT report self-caused seek', () => {
    agent.executeSeek(20);
    video.dispatchEvent(new Event('seeked'));
    vi.advanceTimersByTime(50); // SEEK_DEBOUNCE_MS
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('reports buffering start on waiting event', () => {
    video.dispatchEvent(new Event('waiting'));
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'buffering_start' })
    );
  });

  it('reports buffering end on playing event', () => {
    video.dispatchEvent(new Event('playing'));
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'buffering_end' })
    );
  });

  it('does not increment pendingPause when video is already paused', () => {
    // Video is paused (default), so executePause skips counter
    agent.executePause();
    // Dispatching pause is treated as user-initiated since no counter was set
    video.dispatchEvent(new Event('pause'));
    expect(sendEvent).toHaveBeenCalledTimes(1);
  });

  it('does not increment pendingPlay when video is already playing', () => {
    (video as any)._paused = false;
    agent.executePlay();
    // No counter was set, so dispatching play is treated as user-initiated
    video.dispatchEvent(new Event('play'));
    expect(sendEvent).toHaveBeenCalledTimes(1);
  });

  describe('coordinatorPlaying suppresses buffering echoes', () => {
    it('suppresses waiting/playing during coordinator-initiated play', () => {
      // Video is paused — executePlay sets coordinatorPlaying
      agent.executePlay();
      video.dispatchEvent(new Event('play'));  // consumed by pendingPlay
      video.dispatchEvent(new Event('waiting'));  // suppressed by coordinatorPlaying
      video.dispatchEvent(new Event('playing'));  // clears coordinatorPlaying

      // None of these should have been reported
      expect(sendEvent).not.toHaveBeenCalled();
    });

    it('does not suppress buffering when play was user-initiated', () => {
      // User plays (no executePlay), then video buffers
      video.dispatchEvent(new Event('play'));  // user-initiated
      expect(sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'play' })
      );

      video.dispatchEvent(new Event('waiting'));  // genuine buffering
      expect(sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'buffering_start' })
      );

      video.dispatchEvent(new Event('playing'));  // buffering resolved
      expect(sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'buffering_end' })
      );
    });

    it('clears coordinatorPlaying on pause', () => {
      // Coordinator starts play, but user pauses before 'playing' fires
      agent.executePlay();
      video.dispatchEvent(new Event('play'));  // consumed by pendingPlay

      // User pauses — should clear coordinatorPlaying and report
      video.dispatchEvent(new Event('pause'));
      expect(sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'pause' })
      );

      // Now 'waiting' should NOT be suppressed (coordinatorPlaying was cleared)
      video.dispatchEvent(new Event('waiting'));
      expect(sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'buffering_start' })
      );
    });

    it('suppresses waiting during coordinator-initiated seek', () => {
      agent.executeSeek(50);
      // 'seeking' fires, then 'waiting' — both suppressed during seek
      video.dispatchEvent(new Event('seeking'));
      video.dispatchEvent(new Event('waiting'));
      expect(sendEvent).not.toHaveBeenCalled();

      // 'seeked' fires — consumed by pendingSeek, clears seeking flag
      video.dispatchEvent(new Event('seeked'));
      vi.advanceTimersByTime(60);
      expect(sendEvent).not.toHaveBeenCalled();

      // Now a genuine 'waiting' should go through
      video.dispatchEvent(new Event('waiting'));
      expect(sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'buffering_start' })
      );
    });

    it('suppresses waiting during user-initiated seek', () => {
      // User seeks — no executeSeek, but 'seeking' event fires
      video.dispatchEvent(new Event('seeking'));
      video.dispatchEvent(new Event('waiting'));
      expect(sendEvent).not.toHaveBeenCalled();

      // 'seeked' fires — clears seeking flag, enters debounce
      video.dispatchEvent(new Event('seeked'));
      vi.advanceTimersByTime(60);
      // Only the debounced 'seek' event should be emitted, not buffering_start
      expect(sendEvent).toHaveBeenCalledTimes(1);
      expect(sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'seek' })
      );
    });

    it('executePause clears coordinatorPlaying', () => {
      // Coordinator sends play then immediately sends pause
      agent.executePlay();  // coordinatorPlaying = true

      (video as any)._paused = false; // play() set it to false
      agent.executePause(); // should clear coordinatorPlaying

      video.dispatchEvent(new Event('pause'));  // consumed by pendingPause
      video.dispatchEvent(new Event('waiting'));  // NOT suppressed
      expect(sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'buffering_start' })
      );
    });
  });

  it('getPosition returns current state', () => {
    const pos = agent.getPosition();
    expect(pos.currentTime).toBe(10);
    expect(typeof pos.paused).toBe('boolean');
    expect(typeof pos.timestamp).toBe('number');
  });

  it('cleans up all listeners on destroy', () => {
    const spy = vi.spyOn(video, 'removeEventListener');
    agent.destroy();
    // Should remove listeners for: pause, play, seeking, seeked, waiting, stalled, playing
    expect(spy).toHaveBeenCalledTimes(7);
  });

  it('debounces rapid seeks (scrubbing)', () => {
    // Fire three rapid seek events
    video.dispatchEvent(new Event('seeked'));
    video.dispatchEvent(new Event('seeked'));
    video.dispatchEvent(new Event('seeked'));

    // Not called yet — debouncing
    expect(sendEvent).not.toHaveBeenCalled();

    // Advance past debounce window (SEEK_DEBOUNCE_MS = 50)
    vi.advanceTimersByTime(60);

    // Only called once with the final position
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'seek' })
    );
  });
});
