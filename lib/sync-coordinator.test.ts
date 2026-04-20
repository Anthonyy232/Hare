import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncCoordinator } from './sync-coordinator';
import type { SyncEventPayload } from './sync-types';

// Mock browser.tabs.sendMessage and browser.storage.session
const mockSendMessage = vi.fn().mockResolvedValue({ success: true });
const mockStorageSessionGet = vi.fn().mockResolvedValue({});
const mockStorageSessionSet = vi.fn().mockResolvedValue(undefined);
const mockStorageSessionRemove = vi.fn().mockResolvedValue(undefined);
vi.stubGlobal('browser', {
  tabs: {
    sendMessage: mockSendMessage,
  },
  storage: {
    session: {
      get: mockStorageSessionGet,
      set: mockStorageSessionSet,
      remove: mockStorageSessionRemove,
    },
  },
});

/** Drain the microtask queue for several rounds to let async chains complete */
async function flushPromises(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

describe('SyncCoordinator', () => {
  let coordinator: SyncCoordinator;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSendMessage.mockClear();
    coordinator = new SyncCoordinator();
  });

  afterEach(() => {
    coordinator.destroy();
    vi.useRealTimers();
  });

  describe('session management', () => {
    it('starts with no active session', () => {
      const status = coordinator.getStatus();
      expect(status.active).toBe(false);
    });

    it('creates a session with correct offset', () => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 10, currentTimeB: 15 }
      );
      const status = coordinator.getStatus();
      expect(status.active).toBe(true);
      expect(status.offset).toBe(5); // B is 5s ahead of A
    });

    it('stops a session', () => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 0 }
      );
      coordinator.stopSync();
      expect(coordinator.getStatus().active).toBe(false);
    });

    it('adjusts offset with nudge', () => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 10, currentTimeB: 15 }
      );
      coordinator.nudgeOffset(0.5);
      expect(coordinator.getStatus().offset).toBe(5.5);
    });
  });

  describe('event relay', () => {
    beforeEach(() => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 5 } // offset = 5
      );
    });

    it('relays pause from tab A to tab B', async () => {
      await coordinator.handleSyncEvent(1, {
        action: 'pause',
        position: 10,
        timestamp: Date.now(),
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        2,
        expect.objectContaining({
          type: 'SYNC_PAUSE',
          payload: expect.objectContaining({
            position: 15, // 10 + offset(5)
          }),
        })
      );
    });

    it('relays pause from tab B to tab A', async () => {
      await coordinator.handleSyncEvent(2, {
        action: 'pause',
        position: 20,
        timestamp: Date.now(),
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          type: 'SYNC_PAUSE',
          payload: expect.objectContaining({
            position: 15, // 20 - offset(5)
          }),
        })
      );
    });

    it('relays seek from tab A to tab B with offset', async () => {
      await coordinator.handleSyncEvent(1, {
        action: 'seek',
        position: 30,
        timestamp: Date.now(),
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        2,
        expect.objectContaining({
          type: 'SYNC_SEEK',
          payload: expect.objectContaining({
            position: 35, // 30 + offset(5)
          }),
        })
      );
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

      // Generation should be 2 after two user actions
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

    it('clamps negative target positions to 0', async () => {
      // offset = 5 (B = A + 5). Seeking B to position 3 means target A = 3 - 5 = -2 → clamped to 0
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
            position: 0, // max(0, 3 - 5) = 0
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

  describe('drift correction generation invalidation', () => {
    it('generation increments on user actions prevent stale corrections', async () => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 0 }
      );

      // Two user seeks increment generation to 2
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

      // Verify generation is 2 in status (indirectly via last sent message)
      expect(mockSendMessage).toHaveBeenLastCalledWith(
        2,
        expect.objectContaining({
          payload: expect.objectContaining({ generation: 2 }),
        })
      );
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

    it('pauses other tab when one starts buffering', async () => {
      await coordinator.handleSyncEvent(1, {
        action: 'buffering_start',
        position: 10,
        timestamp: Date.now(),
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ type: 'SYNC_PAUSE' })
      );
    });

    it('does not double-pause when both buffer', async () => {
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

      // Should not send another pause since tab 1 is already being paused
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        1,
        expect.objectContaining({ type: 'SYNC_PAUSE' })
      );
    });

    it('resumes both tabs with position -1 after buffering ends', async () => {
      // Tab 1 starts buffering
      await coordinator.handleSyncEvent(1, {
        action: 'buffering_start',
        position: 10,
        timestamp: Date.now(),
      });
      mockSendMessage.mockClear();

      // Tab 1 finishes buffering
      await coordinator.handleSyncEvent(1, {
        action: 'buffering_end',
        position: 10,
        timestamp: Date.now(),
      });

      // Advance past debounce then flush async callbacks
      vi.advanceTimersByTime(300);
      await flushPromises();

      // Both tabs should receive SYNC_PLAY with position -1 (resume without seeking)
      const calls = mockSendMessage.mock.calls;
      const playToTab1 = calls.find(([tabId, msg]) =>
        tabId === 1 && msg.type === 'SYNC_PLAY' && msg.payload.position === -1
      );
      const playToTab2 = calls.find(([tabId, msg]) =>
        tabId === 2 && msg.type === 'SYNC_PLAY' && msg.payload.position === -1
      );
      expect(playToTab1).toBeDefined();
      expect(playToTab2).toBeDefined();
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

    it('uses rate adjustment for drift below rate-adjust threshold', async () => {
      // Set up positions: A at 100s, B at 100.1s (100ms drift, below 150ms threshold)
      mockSendMessage
        .mockResolvedValueOnce({ currentTime: 100, paused: false, timestamp: Date.now() })
        .mockResolvedValueOnce({ currentTime: 100.1, paused: false, timestamp: Date.now() });

      vi.advanceTimersByTime(2000); // trigger one drift check
      await flushPromises();

      const driftCorrectCall = mockSendMessage.mock.calls.find(
        ([, msg]) => msg.type === 'SYNC_DRIFT_CORRECT'
      );
      expect(driftCorrectCall).toBeDefined();
      expect(driftCorrectCall![1].payload.method).toBe('rate');
    });

    it('uses hard seek for drift at or above rate-adjust threshold', async () => {
      // Set up positions: A at 100s, B at 100.2s (200ms drift, above 150ms threshold)
      mockSendMessage
        .mockResolvedValueOnce({ currentTime: 100, paused: false, timestamp: Date.now() })
        .mockResolvedValueOnce({ currentTime: 100.2, paused: false, timestamp: Date.now() });

      vi.advanceTimersByTime(2000);
      await flushPromises();

      const driftCorrectCall = mockSendMessage.mock.calls.find(
        ([, msg]) => msg.type === 'SYNC_DRIFT_CORRECT'
      );
      expect(driftCorrectCall).toBeDefined();
      expect(driftCorrectCall![1].payload.method).toBe('seek');
    });

    it('ignores drift below ignore threshold', async () => {
      // Set up positions: A at 100s, B at 100.03s (30ms drift, below 50ms threshold)
      mockSendMessage
        .mockResolvedValueOnce({ currentTime: 100, paused: false, timestamp: Date.now() })
        .mockResolvedValueOnce({ currentTime: 100.03, paused: false, timestamp: Date.now() });

      vi.advanceTimersByTime(2000);
      await flushPromises();

      expect(mockSendMessage.mock.calls.every(([, msg]) => msg.type !== 'SYNC_DRIFT_CORRECT')).toBe(true);
    });

    it('skips drift correction when expected position would be negative', async () => {
      // Start a new session with offset=-10 (B is 10s behind A)
      coordinator.destroy();
      coordinator = new SyncCoordinator();
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 10, currentTimeB: 0 } // offset = -10
      );

      // A at 5, B at 0 → expectedB = 5 + (-10) = -5 → should skip
      mockSendMessage
        .mockResolvedValueOnce({ currentTime: 5, paused: false, timestamp: Date.now() })
        .mockResolvedValueOnce({ currentTime: 0, paused: false, timestamp: Date.now() });

      vi.advanceTimersByTime(2000);
      await flushPromises();

      expect(mockSendMessage.mock.calls.every(([, msg]) => msg.type !== 'SYNC_DRIFT_CORRECT')).toBe(true);
    });
  });

  describe('sendToTab error handling', () => {
    it('tolerates transient send failures', async () => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 0 }
      );

      // Single failure should NOT stop sync
      mockSendMessage.mockRejectedValueOnce(new Error('Could not establish connection'));

      await coordinator.handleSyncEvent(1, {
        action: 'pause',
        position: 10,
        timestamp: Date.now(),
      });

      expect(coordinator.getStatus().active).toBe(true);
    });

    it('stops sync after repeated consecutive failures', async () => {
      coordinator.startSync(
        { tabId: 1 },
        { tabId: 2 },
        { currentTimeA: 0, currentTimeB: 0 }
      );

      // 5 consecutive failures should stop sync
      mockSendMessage.mockRejectedValue(new Error('Could not establish connection'));

      for (let i = 0; i < 5; i++) {
        await coordinator.handleSyncEvent(1, {
          action: 'pause',
          position: 10,
          timestamp: Date.now(),
        });
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
        .mockResolvedValueOnce({ success: true })  // resets counter
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
});
