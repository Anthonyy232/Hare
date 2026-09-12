import { browser } from 'wxt/browser';
import { getFrameIds, sendToFrame } from './tab-media';
import type { SyncCoordinator } from './sync-coordinator';
import type { SyncPositionResponse } from './sync-types';

interface Activation extends SyncPositionResponse { frameId: number; }

/** Owns startup/rollback so a partially activated pair never outlives a failed request. */
export class SyncStartup {
  private revision = 0;
  private pending: Promise<void> | null = null;

  constructor(private coordinator: SyncCoordinator) {}

  async start(tabIdA: number, tabIdB: number): Promise<void> {
    if (this.pending) throw new Error('Sync is already starting. Please wait.');
    if (![tabIdA, tabIdB].every(id => Number.isInteger(id) && id >= 0) || tabIdA === tabIdB) {
      throw new Error('Select two different tabs.');
    }
    const revision = ++this.revision;
    this.pending = this.activatePair(tabIdA, tabIdB, revision);
    try { await this.pending; }
    finally { this.pending = null; }
  }

  async stop(): Promise<void> {
    this.revision++;
    await this.coordinator.ready;
    await this.coordinator.stopSync('user stopped sync');
    await this.pending?.catch(() => {});
  }

  private async activatePair(tabIdA: number, tabIdB: number, revision: number): Promise<void> {
    const attempted: Array<{ tabId: number; frameId: number }> = [];
    try {
      await this.coordinator.ready;
      // Old deactivation messages must finish before any replacement agent is created.
      await this.coordinator.stopSync('replacing session');
      if (revision !== this.revision) throw new Error('Sync startup cancelled.');
      const activate = async (tabId: number): Promise<Activation> => {
        for (const frameId of await getFrameIds(tabId)) {
          if (revision !== this.revision) throw new Error('Sync startup cancelled.');
          attempted.push({ tabId, frameId });
          try {
            const result = await sendToFrame(tabId, frameId, { type: 'SYNC_ACTIVATE' }) as Partial<Activation> & { success?: boolean };
            if (result?.success && Number.isFinite(result.currentTime) && Number.isFinite(result.playbackRate)
              && result.playbackRate! > 0 && Number.isFinite(result.timestamp) && typeof result.paused === 'boolean') {
              return { ...result, frameId } as Activation;
            }
          } catch { /* Try the next frame. All attempted frames are cleaned up on failure. */ }
        }
        throw new Error('A selected tab has no available media. Reload it and refresh the tab list.');
      };
      // Wait for BOTH attempts even on failure, so a late success cannot escape rollback.
      const results = await Promise.allSettled([activate(tabIdA), activate(tabIdB), browser.tabs.get(tabIdA), browser.tabs.get(tabIdB)] as const);
      const [a, b, tabA, tabB] = results;
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      if (revision !== this.revision) throw new Error('Sync startup cancelled.');
      if (a.status !== 'fulfilled' || b.status !== 'fulfilled' || tabA.status !== 'fulfilled' || tabB.status !== 'fulfilled') return;

      const rateResponse = await sendToFrame(tabIdB, b.value.frameId, {
        type: 'SYNC_RATE', payload: { action: 'ratechange', rate: a.value.playbackRate, position: 0, timestamp: Date.now(), generation: 0 },
      }) as { success?: boolean };
      if (!rateResponse?.success) throw new Error('The second player could not match the playback speed.');
      // Align play/pause state without changing the two user-selected starting positions.
      if (a.value.paused !== b.value.paused) {
        const stateResponse = await sendToFrame(tabIdB, b.value.frameId, {
          type: a.value.paused ? 'SYNC_PAUSE' : 'SYNC_PLAY',
          payload: { action: a.value.paused ? 'pause' : 'play', position: -1, timestamp: Date.now(), generation: 0 },
        }) as { success?: boolean };
        if (!stateResponse?.success) throw new Error('Press play in both tabs, then try starting sync again.');
      }
      if (revision !== this.revision) throw new Error('Sync startup cancelled.');
      for (const tab of [tabA.value, tabB.value]) {
        this.coordinator.setTabMeta(tab.id!, tab.title || 'Untitled', tab.url ? new URL(tab.url).hostname : '');
      }
      this.coordinator.startSync({ tabId: tabIdA, frameId: a.value.frameId }, { tabId: tabIdB, frameId: b.value.frameId }, {
        currentTimeA: a.value.currentTime, currentTimeB: b.value.currentTime,
        timestampA: a.value.timestamp, timestampB: b.value.timestamp,
        rateA: a.value.playbackRate, rateB: b.value.playbackRate,
        pausedA: a.value.paused, pausedB: b.value.paused,
      });
    } catch (error) {
      await Promise.allSettled(attempted.map(({ tabId, frameId }) => sendToFrame(tabId, frameId, { type: 'SYNC_DEACTIVATE' })));
      throw error;
    }
  }
}
