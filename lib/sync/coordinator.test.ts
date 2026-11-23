import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { SyncCoordinator } from './coordinator';
import { MpvClient } from './mpv';
import { createTransport } from './transport';
import type { SyncPositionResponse } from './types';

type Message = { type: string; payload?: any };

const mockSendMessage = vi.fn();
vi.spyOn(browser.tabs, 'sendMessage').mockImplementation(mockSendMessage);
const frameIds = new Map<number, number>();
vi.spyOn(browser.webNavigation, 'getAllFrames').mockImplementation(
  async ({ tabId }) => [{ frameId: frameIds.get(tabId) ?? 0 }] as never,
);
vi.spyOn(browser.tabs, 'get').mockImplementation(
  async id => ({ id, title: `Tab ${id}`, url: 'https://example.com/' }) as never,
);

const transport = createTransport(new MpvClient({ onEvent: () => {}, onFileChanged: () => {} }));
const activations = new Map<number, SyncPositionResponse>();

function position(overrides: Partial<SyncPositionResponse> = {}): SyncPositionResponse {
  return { currentTime: 0, paused: false, buffering: false, playbackRate: 1, timestamp: Date.now(), ...overrides };
}

function respond(tabId: number, message: Message): unknown {
  if (message.type === 'SYNC_ACTIVATE') return { success: true, ...activations.get(tabId) };
  if (message.type === 'SYNC_GET_POSITION') return position();
  return { success: true };
}

function sent(type: string) {
  return mockSendMessage.mock.calls
    .filter(([, message]) => message.type === type)
    .map(([tabId, message, options]) => ({ tabId, payload: message.payload, frameId: options?.frameId }));
}

const event = (action: string, extra: object = {}) =>
  ({ action, position: 10, timestamp: Date.now(), rate: 1, ...extra }) as never;

describe('SyncCoordinator', () => {
  let coordinator: SyncCoordinator;

  function startPair(
    tabA: number,
    tabB: number,
    positionA: Partial<SyncPositionResponse> = {},
    positionB: Partial<SyncPositionResponse> = {},
  ) {
    activations.set(tabA, position(positionA));
    activations.set(tabB, position(positionB));
    return coordinator.start(tabA, tabB);
  }

  /** Replaces the coordinator as a background worker restart would, keeping session storage. */
  async function restartWorker() {
    const persisted = await browser.storage.session.get(null);
    await coordinator.stop('worker stopped');
    await browser.storage.session.set(persisted);
    coordinator = new SyncCoordinator(transport);
    await coordinator.ready;
    mockSendMessage.mockClear();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    fakeBrowser.storage.resetState();
    frameIds.clear();
    mockSendMessage.mockReset();
    mockSendMessage.mockImplementation(async (tabId: number, message: Message) => respond(tabId, message));
    coordinator = new SyncCoordinator(transport);
    await coordinator.ready;
  });

  afterEach(async () => {
    await coordinator.stop('test finished');
    vi.useRealTimers();
  });

  describe('starting', () => {
    it('rejects invalid and same-tab pairs before changing the current session', async () => {
      await startPair(1, 2);
      await expect(coordinator.start(1, 1)).rejects.toThrow('different');
      await expect(coordinator.start(NaN, 2)).rejects.toThrow('different');
      expect(coordinator.getStatus().active).toBe(true);
    });

    it('waits for an earlier asynchronous stop before starting another pair', async () => {
      await startPair(1, 2);
      const deactivation = Promise.withResolvers<{ success: true }>();
      mockSendMessage.mockImplementation(async (tabId, message) =>
        message.type === 'SYNC_DEACTIVATE' ? deactivation.promise : respond(tabId, message),
      );
      const stopped = coordinator.stop('tab was removed');
      const replacement = startPair(3, 4);
      await vi.advanceTimersByTimeAsync(0);
      expect(coordinator.getStatus().active).toBe(false);
      expect(sent('SYNC_ACTIVATE').map(call => call.tabId)).toEqual([1, 2]);
      deactivation.resolve({ success: true });
      await stopped;
      await replacement;
      expect(coordinator.getStatus()).toMatchObject({ active: true, videoA: { title: 'Tab 3' } });
    });

    it('does not create a replacement after stop arrives during teardown', async () => {
      await startPair(1, 2);
      const deactivation = Promise.withResolvers<{ success: true }>();
      mockSendMessage.mockImplementation(async (tabId, message) =>
        message.type === 'SYNC_DEACTIVATE' ? deactivation.promise : respond(tabId, message),
      );
      const replacement = startPair(3, 4);
      const rejected = expect(replacement).rejects.toThrow('cancelled');
      const stopped = coordinator.stop('user stopped sync');
      deactivation.resolve({ success: true });
      await stopped;
      await rejected;
      expect(coordinator.getStatus().active).toBe(false);
    });

    it('rolls back both frames after a partial failure, including a late activation', async () => {
      const late = Promise.withResolvers<unknown>();
      mockSendMessage.mockImplementation(async (tabId, message) => {
        if (message.type !== 'SYNC_ACTIVATE') return respond(tabId, message);
        return tabId === 1 ? { success: false } : late.promise;
      });
      const rejection = expect(coordinator.start(1, 2)).rejects.toThrow('no available media');
      await vi.waitFor(() => expect(sent('SYNC_ACTIVATE').map(call => call.tabId)).toEqual([1, 2]));
      expect(sent('SYNC_DEACTIVATE')).toEqual([]);
      late.resolve({ success: true, ...position() });
      await rejection;
      expect(coordinator.getStatus().active).toBe(false);
      expect(sent('SYNC_DEACTIVATE').map(call => [call.tabId, call.frameId])).toEqual([
        [1, 0],
        [2, 0],
      ]);
    });

    it('cancels startup and rolls back if stop arrives during activation', async () => {
      const late = Promise.withResolvers<unknown>();
      mockSendMessage.mockImplementation(async (tabId, message) =>
        message.type === 'SYNC_ACTIVATE' ? late.promise : respond(tabId, message),
      );
      const rejection = expect(coordinator.start(1, 2)).rejects.toThrow('cancelled');
      await vi.waitFor(() => expect(sent('SYNC_ACTIVATE')).toHaveLength(2));
      const stopped = coordinator.stop('user stopped sync');
      late.resolve({ success: true, ...position() });
      await rejection;
      await stopped;
      expect(coordinator.getStatus().active).toBe(false);
      expect(sent('SYNC_DEACTIVATE').map(call => call.tabId)).toEqual([1, 2]);
    });

    it("matches B to A's speed and play state before syncing", async () => {
      await startPair(1, 2, { playbackRate: 1.5, paused: true }, { paused: false });
      expect(sent('SYNC_RATE')).toEqual([{ tabId: 2, payload: { rate: 1.5 }, frameId: 0 }]);
      expect(sent('SYNC_PAUSE')).toEqual([{ tabId: 2, payload: {}, frameId: 0 }]);
    });

    it('refuses a second start while one is in progress', async () => {
      const late = Promise.withResolvers<unknown>();
      mockSendMessage.mockImplementation(async (tabId, message) =>
        message.type === 'SYNC_ACTIVATE' ? late.promise : respond(tabId, message),
      );
      const first = coordinator.start(1, 2);
      await expect(coordinator.start(3, 4)).rejects.toThrow('already starting');
      late.resolve({ success: true, ...position() });
      await first;
      expect(coordinator.getStatus()).toMatchObject({ videoA: { title: 'Tab 1' } });
    });

    it('compensates for the time gap between A and B position reads', async () => {
      await startPair(1, 2, { currentTime: 100, timestamp: 1000 }, { currentTime: 100, timestamp: 1500 });
      expect(coordinator.getStatus()).toMatchObject({ offset: expect.closeTo(-0.5, 5) });
    });

    it('does not extrapolate paused inputs', async () => {
      await startPair(1, 2, { currentTime: 100, timestamp: 1000, paused: true }, { currentTime: 100, timestamp: 1500 });
      expect(coordinator.getStatus()).toMatchObject({ offset: expect.closeTo(0, 5) });
    });
  });

  describe('session state', () => {
    it('keeps the latest pair and nudge step across a worker restart', async () => {
      await startPair(1, 2);
      await startPair(3, 4, {}, { currentTime: 5 });
      await coordinator.setNudgeStep(0.5);
      await expect(coordinator.setNudgeStep(NaN)).rejects.toThrow('valid nudge step');
      await expect(coordinator.setNudgeStep(0)).rejects.toThrow('valid nudge step');
      await restartWorker();
      expect(coordinator.getStatus()).toEqual({
        active: true,
        videoA: { title: 'Tab 3' },
        videoB: { title: 'Tab 4' },
        offset: 5,
        nudgeStep: 0.5,
      });
    });

    it('nudges the offset, refuses non-finite updates, and refuses once sync ended', async () => {
      await startPair(1, 2, {}, { currentTime: 5 });
      mockSendMessage.mockImplementation(async (tabId, message) =>
        message.type === 'SYNC_GET_POSITION' ? position({ currentTime: 10, paused: true }) : respond(tabId, message),
      );
      coordinator.nudgeOffset(0.5);
      expect(coordinator.getStatus()).toMatchObject({ offset: 5.5 });
      await vi.waitFor(() =>
        expect(sent('SYNC_DRIFT_CORRECT')).toEqual([
          { tabId: 2, payload: { method: 'seek', position: 15.5 }, frameId: 0 },
        ]),
      );
      expect(() => coordinator.nudgeOffset(NaN)).toThrow('valid offset');
      expect(coordinator.getStatus()).toMatchObject({ offset: 5.5 });
      await coordinator.stop('user stopped sync');
      expect(() => coordinator.nudgeOffset(0.5)).toThrow('ended');
    });

    it('stops sync when a synced tab is removed', async () => {
      await startPair(1, 2);
      coordinator.handleTabRemoved(1);
      expect(coordinator.getStatus().active).toBe(false);
    });

    it('relays events that arrive before the stored session is restored', async () => {
      await startPair(1, 2, {}, { currentTime: 5 });
      const persisted = await browser.storage.session.get(null);
      await coordinator.stop('worker stopped');
      const storage = Promise.withResolvers<Record<string, unknown>>();
      const get = vi.spyOn(browser.storage.session, 'get').mockReturnValueOnce(storage.promise as never);
      coordinator = new SyncCoordinator(transport);
      mockSendMessage.mockClear();
      const relayed = coordinator.handleSyncEvent(1, event('pause'));
      await vi.advanceTimersByTimeAsync(0);
      expect(sent('SYNC_PAUSE')).toEqual([]);
      storage.resolve(persisted);
      await relayed;
      expect(sent('SYNC_PAUSE')).toEqual([{ tabId: 2, payload: { position: 15 }, frameId: 0 }]);
      get.mockRestore();
    });
  });

  describe('event relay', () => {
    beforeEach(async () => {
      await startPair(1, 2, {}, { currentTime: 5 });
      mockSendMessage.mockClear();
    });

    it.each([
      { from: 1, to: 2, action: 'pause', target: 15, type: 'SYNC_PAUSE' },
      { from: 2, to: 1, action: 'pause', target: 5, type: 'SYNC_PAUSE' },
      { from: 1, to: 2, action: 'seek', target: 15, type: 'SYNC_SEEK' },
      { from: 2, to: 1, action: 'seek', position: 3, target: 0, type: 'SYNC_SEEK' },
    ])(
      'relays $action from $from to $to with its offset',
      async ({ from, to, action, target, type, position = 10 }) => {
        await coordinator.handleSyncEvent(from, event(action, { position }));
        expect(sent(type)).toEqual([{ tabId: to, payload: { position: target }, frameId: 0 }]);
      },
    );

    it('tells the other side where the source was and how fast it played', async () => {
      await coordinator.handleSyncEvent(1, event('play', { rate: 2, timestamp: 1234 }));
      expect(sent('SYNC_PLAY')).toEqual([
        { tabId: 2, payload: { from: { position: 15, rate: 2, timestamp: 1234 } }, frameId: 0 },
      ]);
    });

    it.each([
      [1, 2, 1.5],
      [2, 1, 0.5],
    ])('relays rate changes from %s to %s at %sx', async (from, to, rate) => {
      await coordinator.handleSyncEvent(from, event('ratechange', { rate }));
      expect(sent('SYNC_RATE')).toEqual([{ tabId: to, payload: { rate }, frameId: 0 }]);
    });

    it.each([NaN, 0, undefined])('drops an event with an unusable rate: %s', async rate => {
      await coordinator.handleSyncEvent(1, event('ratechange', { rate }));
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('does not relay events from unsynced frames in a synced tab', async () => {
      frameIds.set(2, 7);
      await startPair(1, 2);
      mockSendMessage.mockClear();
      await coordinator.handleSyncEvent(1, event('pause'), 99);
      expect(mockSendMessage).not.toHaveBeenCalled();
      await coordinator.handleSyncEvent(1, event('pause'), 0);
      expect(sent('SYNC_PAUSE')).toEqual([{ tabId: 2, payload: { position: 10 }, frameId: 7 }]);
    });
  });

  describe('buffering', () => {
    beforeEach(async () => {
      await startPair(1, 2);
    });

    it('ignores duplicate and opposite-side recovery while one side still buffers', async () => {
      await coordinator.handleSyncEvent(1, event('buffering_start'));
      await coordinator.handleSyncEvent(2, event('buffering_start'));
      await coordinator.handleSyncEvent(1, event('buffering_end'));
      await vi.advanceTimersByTimeAsync(60);
      await coordinator.handleSyncEvent(1, event('buffering_start'));
      await coordinator.handleSyncEvent(2, event('buffering_end'));
      await vi.advanceTimersByTimeAsync(60);
      mockSendMessage.mockClear();
      await coordinator.handleSyncEvent(2, event('buffering_start'));
      await coordinator.handleSyncEvent(2, event('buffering_start'));
      await coordinator.handleSyncEvent(2, event('buffering_end'));
      await vi.advanceTimersByTimeAsync(60);
      expect(sent('SYNC_PLAY')).toHaveLength(0);
      await coordinator.handleSyncEvent(1, event('buffering_end'));
      await vi.advanceTimersByTimeAsync(60);
      expect(sent('SYNC_PLAY')).toHaveLength(2);
    });

    it('pauses the first stalled player when its partner also buffers', async () => {
      await coordinator.handleSyncEvent(1, event('buffering_start'));
      mockSendMessage.mockClear();
      await coordinator.handleSyncEvent(2, event('buffering_start'));
      expect(sent('SYNC_PAUSE').map(call => call.tabId)).toEqual([1]);
    });

    it('resumes both tabs where they are after buffering ends', async () => {
      await coordinator.handleSyncEvent(1, event('buffering_start'));
      expect(sent('SYNC_PAUSE')).toEqual([{ tabId: 2, payload: { buffering: true, position: 10 }, frameId: 0 }]);
      mockSendMessage.mockClear();
      await coordinator.handleSyncEvent(1, event('buffering_end'));
      await vi.advanceTimersByTimeAsync(300);
      expect(sent('SYNC_PLAY')).toEqual([
        { tabId: 1, payload: {}, frameId: 0 },
        { tabId: 2, payload: {}, frameId: 0 },
      ]);
    });

    it('cancels automatic buffering resume when the user pauses', async () => {
      await coordinator.handleSyncEvent(1, event('buffering_start'));
      await coordinator.handleSyncEvent(1, event('buffering_end'));
      await coordinator.handleSyncEvent(2, event('pause'));
      mockSendMessage.mockClear();
      await vi.advanceTimersByTimeAsync(100);
      expect(sent('SYNC_PLAY')).toHaveLength(0);
    });

    it('pauses without seeking when the buffering target would be negative', async () => {
      await startPair(1, 2, { currentTime: 10 });
      mockSendMessage.mockClear();
      await coordinator.handleSyncEvent(1, event('buffering_start', { position: 5 }));
      expect(sent('SYNC_PAUSE')).toEqual([{ tabId: 2, payload: { buffering: true }, frameId: 0 }]);
    });

    it('starts with an already stalled source without extrapolating its frozen clock', async () => {
      await startPair(
        3,
        4,
        { currentTime: 10, timestamp: 1000, buffering: true },
        { currentTime: 20, timestamp: 2000, paused: true },
      );
      expect(coordinator.getStatus()).toMatchObject({ offset: 10 });
      expect(sent('SYNC_PAUSE')).toContainEqual({ tabId: 4, payload: { buffering: true, position: 20 }, frameId: 0 });
    });

    it('polls stalled endpoints so a disconnected tab cannot leave sync stuck', async () => {
      await coordinator.handleSyncEvent(1, event('buffering_start'));
      mockSendMessage.mockRejectedValue(new Error('Frame navigated'));
      await vi.advanceTimersByTimeAsync(10000);
      expect(coordinator.getStatus().active).toBe(false);
    });

    it('resumes after a worker restart even if the buffering end event was lost', async () => {
      await coordinator.handleSyncEvent(1, event('buffering_start'));
      await coordinator.handleSyncEvent(2, event('buffering_start'));
      await restartWorker();
      mockSendMessage.mockImplementation(async (tabId, message) =>
        message.type === 'SYNC_GET_POSITION' ? position({ currentTime: 10, paused: true }) : respond(tabId, message),
      );
      await vi.advanceTimersByTimeAsync(2100);
      expect(sent('SYNC_PLAY')).toHaveLength(2);
    });
  });

  describe('drift correction', () => {
    beforeEach(async () => {
      await startPair(1, 2);
      mockSendMessage.mockClear();
    });

    it.each([
      { drift: 0.03, method: undefined },
      { drift: 0.1, method: 'rate' },
      { drift: 0.2, method: 'seek' },
    ])('corrects $drift seconds of drift with $method', async ({ drift, method }) => {
      mockSendMessage
        .mockResolvedValueOnce(position({ currentTime: 100 }))
        .mockResolvedValueOnce(position({ currentTime: 100 + drift }));
      await vi.advanceTimersByTimeAsync(2000);
      expect(sent('SYNC_DRIFT_CORRECT')[0]?.payload.method).toBe(method);
    });

    it('skips drift correction when expected position would be negative', async () => {
      await startPair(1, 2, { currentTime: 10 });
      mockSendMessage
        .mockResolvedValueOnce(position({ currentTime: 5 }))
        .mockResolvedValueOnce(position({ currentTime: 0 }));
      await vi.advanceTimersByTimeAsync(2000);
      expect(sent('SYNC_DRIFT_CORRECT')).toEqual([]);
    });

    it('does not flag false drift when both tabs play at the same non-1.0x rate', async () => {
      // Both at 2.0x, sampled 1s apart; rate-blind extrapolation would see 1s of drift.
      const now = Date.now();
      mockSendMessage
        .mockResolvedValueOnce(position({ currentTime: 100, playbackRate: 2, timestamp: now - 1000 }))
        .mockResolvedValueOnce(position({ currentTime: 102, playbackRate: 2, timestamp: now }));
      await vi.advanceTimersByTimeAsync(2000);
      expect(sent('SYNC_DRIFT_CORRECT')).toEqual([]);
    });

    it('skips correction when one tab is paused and the other is playing', async () => {
      mockSendMessage
        .mockResolvedValueOnce(position({ currentTime: 100, paused: true }))
        .mockResolvedValueOnce(position({ currentTime: 100.5 }));
      await vi.advanceTimersByTimeAsync(2000);
      expect(sent('SYNC_DRIFT_CORRECT')).toEqual([]);
    });

    it('does not send a stale drift correction to a replacement session', async () => {
      let resolveOld!: (position: unknown) => void;
      mockSendMessage.mockImplementation((tabId, message) => {
        if (message.type === 'SYNC_GET_POSITION' && tabId === 1)
          return new Promise(resolve => {
            resolveOld = resolve;
          });
        if (message.type === 'SYNC_GET_POSITION') return Promise.resolve(position({ currentTime: 20 }));
        return Promise.resolve(respond(tabId, message));
      });
      await vi.advanceTimersByTimeAsync(2000);
      await startPair(3, 4);
      mockSendMessage.mockClear();
      resolveOld(position({ currentTime: 10 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(sent('SYNC_DRIFT_CORRECT')).toEqual([]);
    });
  });

  describe('unresponsive players', () => {
    beforeEach(async () => {
      await startPair(1, 2);
    });

    it.each(['connection rejection', 'content failure'])('stops sync after repeated %s', async failure => {
      if (failure === 'connection rejection')
        mockSendMessage.mockRejectedValue(new Error('Could not establish connection'));
      else mockSendMessage.mockResolvedValue({ success: false, error: 'No active sync agent' });
      for (let i = 0; i < 5; i++) await coordinator.handleSyncEvent(1, event('pause'));
      expect(coordinator.getStatus().active).toBe(false);
    });

    it.each([false, {}, { currentTime: 1, paused: false, buffering: false, playbackRate: 0, timestamp: 1 }])(
      'ends sync after repeated malformed position replies: %j',
      async response => {
        mockSendMessage.mockResolvedValue(response);
        await vi.advanceTimersByTimeAsync(10000);
        expect(coordinator.getStatus().active).toBe(false);
        expect(sent('SYNC_DRIFT_CORRECT')).toEqual([]);
      },
    );

    it('bounds unanswered position requests without overlapping drift polls', async () => {
      mockSendMessage.mockReset();
      mockSendMessage.mockImplementation(() => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(25000);
      expect(coordinator.getStatus().active).toBe(false);
      expect(sent('SYNC_GET_POSITION')).toHaveLength(10);
    });

    it('does not let healthy peer responses reset failures for a dead endpoint', async () => {
      mockSendMessage.mockImplementation(async (tabId: number, message: Message) =>
        message.type === 'SYNC_GET_POSITION' && tabId === 2 ? null : respond(tabId, message),
      );
      for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(2000);
      expect(coordinator.getStatus().active).toBe(false);
    });

    it('resets the failure count on a successful send', async () => {
      const fail = () => mockSendMessage.mockRejectedValueOnce(new Error('fail'));
      for (let i = 0; i < 4; i++) fail();
      mockSendMessage.mockResolvedValueOnce({ success: true });
      for (let i = 0; i < 4; i++) fail();
      for (let i = 0; i < 9; i++) await coordinator.handleSyncEvent(1, event('pause'));
      expect(coordinator.getStatus().active).toBe(true);
    });
  });
});
