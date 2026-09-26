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
              && result.playbackRate! > 0 && Number.isFinite(result.timestamp) && typeof result.paused === 'boolean'
              && typeof result.buffering === 'boolean') {
              return { ...result, frameId } as Activation;
            }
          } catch { /* Try the next frame. All attempted frames are cleaned up on failure. */ }
        }
        throw new Error('A selected tab has no available media. Reload it and refresh the tab list.');
      };
      const attempts = [activate(tabIdA), activate(tabIdB), browser.tabs.get(tabIdA), browser.tabs.get(tabIdB)] as const;
      // Wait for late activations before propagating a rejection, so rollback includes them.
      await Promise.allSettled(attempts);
      const [a, b, tabA, tabB] = await Promise.all(attempts);
      if (revision !== this.revision) throw new Error('Sync startup cancelled.');

      const rateResponse = await sendToFrame(tabIdB, b.frameId, {
        type: 'SYNC_RATE', payload: { action: 'ratechange', rate: a.playbackRate, position: 0, timestamp: Date.now(), generation: 0 },
      }) as { success?: boolean };
      if (!rateResponse?.success) throw new Error('The second player could not match the playback speed.');
      // Align play/pause state without changing the two user-selected starting positions.
      if (a.paused !== b.paused) {
        const stateResponse = await sendToFrame(tabIdB, b.frameId, {
          type: a.paused ? 'SYNC_PAUSE' : 'SYNC_PLAY',
          payload: { action: a.paused ? 'pause' : 'play', position: -1, timestamp: Date.now(), generation: 0 },
        }) as { success?: boolean };
        if (!stateResponse?.success) throw new Error('Press play in both tabs, then try starting sync again.');
      }
      if (revision !== this.revision) throw new Error('Sync startup cancelled.');
      for (const tab of [tabA, tabB]) {
        this.coordinator.setTabMeta(tab.id!, tab.title || 'Untitled', tab.url ? new URL(tab.url).hostname : '');
      }
      this.coordinator.startSync({ tabId: tabIdA, frameId: a.frameId }, { tabId: tabIdB, frameId: b.frameId }, {
        currentTimeA: a.currentTime, currentTimeB: b.currentTime,
        timestampA: a.timestamp, timestampB: b.timestamp,
        rateA: a.playbackRate, rateB: b.playbackRate,
        pausedA: a.paused, pausedB: b.paused, bufferingA: a.buffering, bufferingB: b.buffering,
      });
    } catch (error) {
      await Promise.allSettled(attempted.map(({ tabId, frameId }) => sendToFrame(tabId, frameId, { type: 'SYNC_DEACTIVATE' })));
      throw error;
    }
  }
}
