import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncCoordinator } from './sync-coordinator';

import { browser } from 'wxt/browser';

const mockSendMessage = vi.fn().mockResolvedValue({ success: true });
const mockStorageSessionGet = vi.fn().mockResolvedValue({});
vi.spyOn(browser.tabs, 'sendMessage').mockImplementation(mockSendMessage);
vi.spyOn(browser.storage.session, 'get').mockImplementation(mockStorageSessionGet);
const mockStorageSessionSet = vi.spyOn(browser.storage.session, 'set').mockResolvedValue(undefined);
vi.spyOn(browser.storage.session, 'remove').mockResolvedValue(undefined);

describe('SyncCoordinator', () => {
  let coordinator: SyncCoordinator;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockSendMessage.mockReset();
    mockSendMessage.mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === 'SYNC_GET_POSITION') {
        return { currentTime: 0, paused: false, buffering: false, playbackRate: 1, timestamp: Date.now() };
      }
      return { success: true };
    });
    coordinator = new SyncCoordinator();
    await coordinator.restoreSession();
  });

  afterEach(() => {
    coordinator.destroy();
    vi.useRealTimers();
  });

  describe('session management', () => {
    it('does not retain metadata from earlier sync pairs in session storage', async () => {
      for (const id of [1, 2]) coordinator.setTabMeta(id, `Tab ${id}`, 'old.example');
      coordinator.startSync({ tabId: 1 }, { tabId: 2 }, { currentTimeA: 0, currentTimeB: 0 });
      for (const id of [3, 4]) coordinator.setTabMeta(id, `Tab ${id}`, 'new.example');
      coordinator.startSync({ tabId: 3 }, { tabId: 4 }, { currentTimeA: 0, currentTimeB: 0 });
      await coordinator.setNudgeStep(0.1);
      expect(mockStorageSessionSet).toHaveBeenLastCalledWith({ syncSession_v2: expect.objectContaining({
        tabMeta: [[3, { title: 'Tab 3', domain: 'new.example' }], [4, { title: 'Tab 4', domain: 'new.example' }]],
      }) });
    });

    it('persists a selected nudge step with the session', async () => {
      coordinator.startSync({ tabId: 1 }, { tabId: 2 }, { currentTimeA: 0, currentTimeB: 5 });
      await coordinator.setNudgeStep(0.5);
      expect(coordinator.getStatus().nudgeStep).toBe(0.5);
      expect(mockStorageSessionSet).toHaveBeenLastCalledWith({ syncSession_v2: expect.objectContaining({ session: expect.objectContaining({ nudgeStep: 0.5 }) }) });
      await expect(coordinator.setNudgeStep(NaN)).rejects.toThrow('valid nudge step');
      await expect(coordinator.setNudgeStep(0)).rejects.toThrow('valid nudge step');
      expect(coordinator.getStatus().nudgeStep).toBe(0.5);
    });

    it.each([false, {},
      { currentTime: 1, paused: false, buffering: false, playbackRate: 0, timestamp: 1 },
    ])('ends sync after repeated malformed position replies: %j', async response => {
      coordinator.startSync({ tabId: 1 }, { tabId: 2 }, { currentTimeA: 0, currentTimeB: 0 });
      mockSendMessage.mockResolvedValue(response);
      await vi.advanceTimersByTimeAsync(10000);
      expect(coordinator.getStatus().active).toBe(false);
      expect(mockSendMessage.mock.calls.some(call => call[1].type === 'SYNC_DRIFT_CORRECT')).toBe(false);
    });

    it('does not send a stale drift correction to a replacement session', async () => {
      let resolveOld!: (position: unknown) => void;
      coordinator.startSync({ tabId: 1 }, { tabId: 2 }, { currentTimeA: 0, currentTimeB: 0 });
      mockSendMessage.mockImplementation((tabId, message) => {
        if (message.type === 'SYNC_GET_POSITION' && tabId === 1) return new Promise(resolve => { resolveOld = resolve; });
        if (message.type === 'SYNC_GET_POSITION') return Promise.resolve({ currentTime: 20, paused: false, buffering: false, playbackRate: 1, timestamp: Date.now() });
        return Promise.resolve({ success: true });
      });
      await vi.advanceTimersByTimeAsync(2000);
      coordinator.startSync({ tabId: 3 }, { tabId: 4 }, { currentTimeA: 0, currentTimeB: 0 });
      mockSendMessage.mockClear();
      resolveOld({ currentTime: 10, paused: false, buffering: false, playbackRate: 1, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(0);
      expect(mockSendMessage.mock.calls.filter(call => call[1].type === 'SYNC_DRIFT_CORRECT')).toHaveLength(0);
    });

    it('bounds unanswered position requests without overlapping drift polls', async () => {
      coordinator.startSync({ tabId: 1 }, { tabId: 2 }, { currentTimeA: 0, currentTimeB: 0 });
      mockSendMessage.mockImplementation(() => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(22000);
      expect(coordinator.getStatus().active).toBe(false);
      expect(mockSendMessage.mock.calls.filter(([, msg]) => msg.type === 'SYNC_GET_POSITION')).toHaveLength(10);
    });

    it('cancels automatic buffering resume when the user pauses', async () => {
      coordinator.startSync({ tabId: 1 }, { tabId: 2 }, { currentTimeA: 0, currentTimeB: 0 });
      await coordinator.handleSyncEvent(1, { action: 'buffering_start', position: 0, timestamp: Date.now() });
      await coordinator.handleSyncEvent(1, { action: 'buffering_end', position: 0, timestamp: Date.now() });
      await coordinator.handleSyncEvent(2, { action: 'pause', position: 0, timestamp: Date.now() });
      mockSendMessage.mockClear();
      await vi.advanceTimersByTimeAsync(100);
      expect(mockSendMessage.mock.calls.filter(call => call[1].type === 'SYNC_PLAY')).toHaveLength(0);
    });

    it('nudges the offset and ignores non-finite updates', () => {
      coordinator.startSync({ tabId: 1 }, { tabId: 2 }, { currentTimeA: 0, currentTimeB: 5 });
      coordinator.nudgeOffset(0.5);
      expect(coordinator.getStatus().offset).toBe(5.5);
      coordinator.nudgeOffset(NaN);
      expect(coordinator.getStatus().offset).toBe(5.5);
    });

    it('discards an invalid persisted session and releases readiness', async () => {
      mockStorageSessionGet.mockResolvedValueOnce({ syncSession_v2: { session: { videoA: { tabId: 1 }, offset: NaN } } });
      const restored = new SyncCoordinator();
      await restored.restoreSession();
      await restored.ready;
      expect(restored.getStatus().active).toBe(false);
      restored.destroy();
    });
  });

  describe('event relay', () => {
    beforeEach(() => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 5 }
      );
    });

    it.each([
      { from: 1, to: 2, action: 'pause', position: 10, target: 15, type: 'SYNC_PAUSE' },
      { from: 2, to: 1, action: 'pause', position: 20, target: 15, type: 'SYNC_PAUSE' },
      { from: 1, to: 2, action: 'seek', position: 30, target: 35, type: 'SYNC_SEEK' },
    ] as const)('relays $action from $from to $to with its offset', async ({ from, to, action, position, target, type }) => {
      await coordinator.handleSyncEvent(from, { action, position, timestamp: Date.now() });
      expect(mockSendMessage).toHaveBeenCalledWith(to, expect.objectContaining({
        type, payload: expect.objectContaining({ position: target }),
      }));
    });

    it('increments generation on user actions', async () => {
      await coordinator.handleSyncEvent(1, {
        action: 'seek',
        position: 10,
        timestamp: Date.now(),
      });

      await coordinator.handleSyncEvent(1, {
        action: 'seek',
        position: 20,
        timestamp: Date.now(),
      });

      expect(mockSendMessage).toHaveBeenLastCalledWith(
        2,
        expect.objectContaining({
          payload: expect.objectContaining({ generation: 2 }),
        })
      );
    });

    it('does not relay events from unknown tabs', async () => {
      await coordinator.handleSyncEvent(999, {
        action: 'pause',
        position: 10,
        timestamp: Date.now(),
      });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('does not relay events from unsynced frames in a synced tab', async () => {
      coordinator.stopSync();
      coordinator.startSync(
        { tabId: 1, frameId: 0 },
        { tabId: 2, frameId: 7 },
        { currentTimeA: 0, currentTimeB: 5 }
      );
      mockSendMessage.mockClear();

      await coordinator.handleSyncEvent(1, {
        action: 'pause',
        position: 10,
        timestamp: Date.now(),
      }, 99);

      expect(mockSendMessage).not.toHaveBeenCalled();

      await coordinator.handleSyncEvent(1, {
        action: 'pause',
        position: 10,
        timestamp: Date.now(),
      }, 0);

      expect(mockSendMessage).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ type: 'SYNC_PAUSE' }),
        { frameId: 7 }
      );
    });

    it('clamps negative target positions to 0', async () => {
      await coordinator.handleSyncEvent(2, {
        action: 'seek',
        position: 3,
        timestamp: Date.now(),
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          type: 'SYNC_SEEK',
          payload: expect.objectContaining({
            position: 0,
          }),
        })
      );
    });
  });

  describe('tab lifecycle', () => {
    it('stops sync when a synced tab is removed', () => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 0 }
      );

      coordinator.handleTabRemoved(1);
      expect(coordinator.getStatus().active).toBe(false);
    });

    it('ignores removal of unrelated tabs', () => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 0 }
      );

      coordinator.handleTabRemoved(999);
      expect(coordinator.getStatus().active).toBe(true);
    });
  });

  describe('buffering', () => {
    beforeEach(() => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 0 }
      );
    });

    it('ignores duplicate and opposite-side recovery while one side still buffers', async () => {
      await coordinator.handleSyncEvent(1, { action: 'buffering_start', position: 10, timestamp: Date.now() });
      await coordinator.handleSyncEvent(2, { action: 'buffering_start', position: 10, timestamp: Date.now() });
      await coordinator.handleSyncEvent(1, { action: 'buffering_end', position: 10, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(60);
      await coordinator.handleSyncEvent(1, { action: 'buffering_start', position: 10, timestamp: Date.now() });
      await coordinator.handleSyncEvent(2, { action: 'buffering_end', position: 10, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(60);
      mockSendMessage.mockClear();
      await coordinator.handleSyncEvent(2, { action: 'buffering_start', position: 10, timestamp: Date.now() });
      await coordinator.handleSyncEvent(2, { action: 'buffering_start', position: 10, timestamp: Date.now() });
      await coordinator.handleSyncEvent(2, { action: 'buffering_end', position: 10, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(60);
      expect(mockSendMessage.mock.calls.filter(([, msg]) => msg.type === 'SYNC_PLAY')).toHaveLength(0);
      await coordinator.handleSyncEvent(1, { action: 'buffering_end', position: 10, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(60);
      expect(mockSendMessage.mock.calls.filter(([, msg]) => msg.type === 'SYNC_PLAY')).toHaveLength(2);
    });

    it('polls stalled endpoints so a disconnected tab cannot leave sync stuck', async () => {
      await coordinator.handleSyncEvent(1, { action: 'buffering_start', position: 10, timestamp: Date.now() });
      mockSendMessage.mockRejectedValue(new Error('Frame navigated'));
      await vi.advanceTimersByTimeAsync(10000);
      expect(coordinator.getStatus().active).toBe(false);
    });

    it('restores buffering recovery after worker restart even if the end event was lost', async () => {
      mockStorageSessionGet.mockResolvedValueOnce({ syncSession_v2: {
        session: { videoA: { tabId: 1 }, videoB: { tabId: 2 }, offset: 0, nudgeStep: 0.1, generation: 0, bufferingTab: 'both' },
        tabMeta: [],
      } });
      coordinator.destroy();
      coordinator = new SyncCoordinator();
      await coordinator.restoreSession();
      mockSendMessage.mockImplementation(async (_tabId, message) => message.type === 'SYNC_GET_POSITION'
        ? { currentTime: 10, paused: true, buffering: false, playbackRate: 1, timestamp: Date.now() }
        : { success: true });
      await vi.advanceTimersByTimeAsync(2100);
      expect(mockSendMessage.mock.calls.filter(([, msg]) => msg.type === 'SYNC_PLAY')).toHaveLength(2);
    });

    it('starts with an already stalled source without extrapolating its frozen clock', () => {
      coordinator.startSync({ tabId: 3 }, { tabId: 4 }, {
        currentTimeA: 10, currentTimeB: 20, timestampA: 1000, timestampB: 2000,
        pausedA: false, pausedB: true, bufferingA: true,
      });
      expect(coordinator.getStatus().offset).toBe(10);
      expect(mockSendMessage).toHaveBeenCalledWith(4, expect.objectContaining({
        type: 'SYNC_PAUSE', payload: expect.objectContaining({ buffering: true, position: 20 }),
      }));
    });

    it('pauses the first stalled player when its partner also buffers', async () => {
      await coordinator.handleSyncEvent(1, {
        action: 'buffering_start',
        position: 10,
        timestamp: Date.now(),
      });
      mockSendMessage.mockClear();

      await coordinator.handleSyncEvent(2, {
        action: 'buffering_start',
        position: 10,
        timestamp: Date.now(),
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ type: 'SYNC_PAUSE' })
      );
    });

    it('resumes both tabs with position -1 after buffering ends', async () => {
      await coordinator.handleSyncEvent(1, {
        action: 'buffering_start',
        position: 10,
        timestamp: Date.now(),
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        2, expect.objectContaining({ type: 'SYNC_PAUSE' })
      );
      mockSendMessage.mockClear();

      await coordinator.handleSyncEvent(1, {
        action: 'buffering_end',
        position: 10,
        timestamp: Date.now(),
      });

      await vi.advanceTimersByTimeAsync(300);

      for (const tabId of [1, 2]) {
        expect(mockSendMessage).toHaveBeenCalledWith(tabId, expect.objectContaining({
          type: 'SYNC_PLAY', payload: expect.objectContaining({ position: -1 }),
        }));
      }
    });

    it('pauses without seeking when the buffering target would be negative', async () => {
      coordinator.destroy();
      coordinator = new SyncCoordinator();
      await coordinator.restoreSession();
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 10, currentTimeB: 0 }
      );
      mockSendMessage.mockClear();

      await coordinator.handleSyncEvent(1, {
        action: 'buffering_start',
        position: 5,
        timestamp: Date.now(),
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        2,
        expect.objectContaining({
          type: 'SYNC_PAUSE',
          payload: expect.objectContaining({ position: -1 }),
        })
      );
    });
  });

  describe('drift correction thresholds', () => {
    beforeEach(() => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 0 }
      );
    });
    it.each([
      { drift: 0.03, method: undefined },
      { drift: 0.1, method: 'rate' },
      { drift: 0.2, method: 'seek' },
    ])('corrects $drift seconds of drift with $method', async ({ drift, method }) => {
      mockSendMessage
        .mockResolvedValueOnce({ currentTime: 100, paused: false, buffering: false, playbackRate: 1, timestamp: Date.now() })
        .mockResolvedValueOnce({ currentTime: 100 + drift, paused: false, buffering: false, playbackRate: 1, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(2000);
      const correction = mockSendMessage.mock.calls.find(([, msg]) => msg.type === 'SYNC_DRIFT_CORRECT');
      if (method) expect(correction?.[1].payload.method).toBe(method);
      else expect(correction).toBeUndefined();
    });

    it('skips drift correction when expected position would be negative', async () => {
      coordinator.destroy();
      coordinator = new SyncCoordinator();
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 10, currentTimeB: 0 }
      );

      mockSendMessage
        .mockResolvedValueOnce({ currentTime: 5, paused: false, buffering: false, playbackRate: 1, timestamp: Date.now() })
        .mockResolvedValueOnce({ currentTime: 0, paused: false, buffering: false, playbackRate: 1, timestamp: Date.now() });

      await vi.advanceTimersByTimeAsync(2000);

      expect(mockSendMessage.mock.calls.every(([, msg]) => msg.type !== 'SYNC_DRIFT_CORRECT')).toBe(true);
    });
  });

  describe('sendToTab error handling', () => {
    it.each(['connection rejection', 'content failure'])('stops sync after repeated %s', async failure => {
      coordinator.startSync({ tabId: 1 }, { tabId: 2 }, { currentTimeA: 0, currentTimeB: 0 });
      if (failure === 'connection rejection') mockSendMessage.mockRejectedValue(new Error('Could not establish connection'));
      else mockSendMessage.mockResolvedValue({ success: false, error: 'No active sync agent' });
      for (let i = 0; i < 5; i++) {
        await coordinator.handleSyncEvent(1, { action: 'pause', position: 10, timestamp: Date.now() });
      }
      expect(coordinator.getStatus().active).toBe(false);
    });

    it('does not let healthy peer responses reset failures for a dead endpoint', async () => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 0 }
      );

      mockSendMessage.mockImplementation(async (tabId: number, message: { type: string }) => {
        if (message.type === 'SYNC_GET_POSITION') {
          if (tabId === 1) {
            return { currentTime: 100, paused: false, buffering: false, playbackRate: 1, timestamp: Date.now() };
          }
          return null;
        }
        return { success: true };
      });

      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      expect(coordinator.getStatus().active).toBe(false);
    });

    it('resets failure count on successful send', async () => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 0 }
      );

      // 2 failures, then success, then 2 more failures — should NOT stop
      mockSendMessage
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'));

      for (let i = 0; i < 5; i++) {
        await coordinator.handleSyncEvent(1, {
          action: 'pause',
          position: 10,
          timestamp: Date.now(),
        });
      }

      expect(coordinator.getStatus().active).toBe(true);
    });
  });

  describe('rate-aware drift correction', () => {
    beforeEach(() => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 0 }
      );
    });

    it('does not flag false drift when both tabs play at non-1.0x but the same rate', async () => {
      // Both at 2.0x, sampled 1s apart; if extrapolation was rate-blind it
      // would compute a 1s drift and issue a seek correction.
      const now = Date.now();
      mockSendMessage
        .mockResolvedValueOnce({ currentTime: 100, paused: false, buffering: false, playbackRate: 2.0, timestamp: now - 1000 })
        .mockResolvedValueOnce({ currentTime: 102, paused: false, buffering: false, playbackRate: 2.0, timestamp: now });

      await vi.advanceTimersByTimeAsync(2000);

      const driftCorrectCall = mockSendMessage.mock.calls.find(
        ([, msg]) => msg.type === 'SYNC_DRIFT_CORRECT'
      );
      expect(driftCorrectCall).toBeUndefined();
    });

    it('skips correction when one tab is paused and the other is playing', async () => {
      const now = Date.now();
      mockSendMessage
        .mockResolvedValueOnce({ currentTime: 100, paused: true, buffering: false, playbackRate: 1.0, timestamp: now })
        .mockResolvedValueOnce({ currentTime: 100.5, paused: false, buffering: false, playbackRate: 1.0, timestamp: now });

      await vi.advanceTimersByTimeAsync(2000);

      const driftCorrectCall = mockSendMessage.mock.calls.find(
        ([, msg]) => msg.type === 'SYNC_DRIFT_CORRECT'
      );
      expect(driftCorrectCall).toBeUndefined();
    });

  });

  describe('rate change relay', () => {
    beforeEach(() => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 5 }
      );
    });

    it.each([[1, 2, 1.5], [2, 1, 0.5]])('relays rate changes from %s to %s at %sx', async (from, to, rate) => {
      await coordinator.handleSyncEvent(from, { action: 'ratechange', position: 0, timestamp: Date.now(), rate });
      expect(mockSendMessage).toHaveBeenCalledWith(to, expect.objectContaining({
        type: 'SYNC_RATE', payload: expect.objectContaining({ action: 'ratechange', rate }),
      }));
    });

    it('drops a ratechange event with no rate field', async () => {
      await coordinator.handleSyncEvent(1, {
        action: 'ratechange',
        position: 0,
        timestamp: Date.now(),
      });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('startSync measurement-skew compensation', () => {
    it('compensates for the time gap between A and B position reads', () => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        {
          currentTimeA: 100,
          currentTimeB: 100,
          timestampA: 1000,
          timestampB: 1500,
          rateA: 1,
          rateB: 1,
          pausedA: false,
          pausedB: false,
        }
      );

      expect(coordinator.getStatus().offset).toBeCloseTo(-0.5, 5);
    });

    it('does not extrapolate paused inputs', () => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        {
          currentTimeA: 100,
          currentTimeB: 100,
          timestampA: 1000,
          timestampB: 1500,
          rateA: 1,
          rateB: 1,
          pausedA: true,
          pausedB: false,
        }
      );

      expect(coordinator.getStatus().offset).toBeCloseTo(0, 5);
    });
  });

  describe('ready gate', () => {
    it('handleSyncEvent waits for restoreSession before processing', async () => {
      const fresh = new SyncCoordinator();
      fresh.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 0 }
      );
      mockSendMessage.mockClear();

      const eventPromise = fresh.handleSyncEvent(1, {
        action: 'pause',
        position: 10,
        timestamp: Date.now(),
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        2,
        expect.objectContaining({ type: 'SYNC_PAUSE' })
      );

      await fresh.restoreSession();
      await eventPromise;
      expect(mockSendMessage).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ type: 'SYNC_PAUSE' })
      );

      fresh.destroy();
    });
  });
});
