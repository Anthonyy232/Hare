import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncStartup } from './sync-startup';
import type { SyncCoordinator } from './sync-coordinator';

const mocks = vi.hoisted(() => ({ send: vi.fn(), get: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { tabs: { get: mocks.get } } }));
vi.mock('./tab-media', () => ({ getFrameIds: async () => [0], sendToFrame: mocks.send }));

const activation = { success: true, currentTime: 10, playbackRate: 1, paused: true, timestamp: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function setup() {
  const coordinator = { ready: Promise.resolve(), stopSync: vi.fn().mockResolvedValue(undefined), startSync: vi.fn(), setTabMeta: vi.fn() };
  return { coordinator, startup: new SyncStartup(coordinator as unknown as SyncCoordinator) };
}

describe('sync startup transaction', () => {
  beforeEach(() => {
    mocks.send.mockReset(); mocks.get.mockReset();
    mocks.get.mockImplementation(async id => ({ id, title: `Tab ${id}`, url: 'https://example.com' }));
    mocks.send.mockImplementation(async (_tab, _frame, message) => message.type === 'SYNC_ACTIVATE' ? activation : { success: true });
  });
  it('rejects invalid/same-tab pairs before changing the current session', async () => {
    const { coordinator, startup } = setup();
    await expect(startup.start(1, 1)).rejects.toThrow('different');
    await expect(startup.start(NaN, 2)).rejects.toThrow('different');
    expect(coordinator.stopSync).not.toHaveBeenCalled();
  });
  it('waits for previous deactivation before activating a replacement', async () => {
    const { coordinator, startup } = setup();
    const stopped = deferred<void>(); coordinator.stopSync.mockReturnValue(stopped.promise);
    const started = startup.start(1, 2);
    await Promise.resolve(); await Promise.resolve();
    expect(mocks.send).not.toHaveBeenCalled();
    stopped.resolve(); await started;
    expect(coordinator.startSync).toHaveBeenCalledOnce();
  });
  it('rolls back both frames after a partial failure, including a late activation', async () => {
    const { coordinator, startup } = setup();
    const late = deferred<typeof activation>();
    mocks.send.mockImplementation(async (tab, _frame, message) => {
      if (message.type !== 'SYNC_ACTIVATE') return { success: true };
      if (tab === 1) return { success: false };
      return late.promise;
    });
    const start = startup.start(1, 2);
    const rejection = expect(start).rejects.toThrow('no available media');
    late.resolve(activation);
    await rejection;
    expect(coordinator.startSync).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledWith(1, 0, { type: 'SYNC_DEACTIVATE' });
    expect(mocks.send).toHaveBeenCalledWith(2, 0, { type: 'SYNC_DEACTIVATE' });
  });
  it('cancels startup and rolls back if stop arrives during activation', async () => {
    const { coordinator, startup } = setup();
    const late = deferred<typeof activation>();
    mocks.send.mockImplementation(async (_tab, _frame, message) => message.type === 'SYNC_ACTIVATE' ? late.promise : { success: true });
    const start = startup.start(1, 2);
    const rejection = expect(start).rejects.toThrow('cancelled');
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const stopped = startup.stop();
    late.resolve(activation);
    await rejection; await stopped;
    expect(coordinator.startSync).not.toHaveBeenCalled();
  });
});
