import { browser } from 'wxt/browser';
import { getFrameIds } from './messaging';
import { isEndpointId, mpv, MPV_TAB_ID, sendToEndpoint } from './mpv';
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
    if (![tabIdA, tabIdB].every(isEndpointId) || tabIdA === tabIdB) {
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
        for (const frameId of tabId === MPV_TAB_ID ? [0] : await getFrameIds(tabId)) {
          if (revision !== this.revision) throw new Error('Sync startup cancelled.');
          attempted.push({ tabId, frameId });
          try {
            const result = await sendToEndpoint(tabId, { type: 'SYNC_ACTIVATE' }, frameId);
            if (result.success) return { ...result, frameId };
          } catch { /* Try the next frame. All attempted frames are cleaned up on failure. */ }
        }
        throw new Error('A selected tab has no available media. Reload it and refresh the tab list.');
      };
      const describe = async (tabId: number) => {
        if (tabId === MPV_TAB_ID) return null;
        const tab = await browser.tabs.get(tabId);
        return { title: tab.title || 'Untitled', domain: tab.url ? new URL(tab.url).hostname : '' };
      };
      const attempts = [activate(tabIdA), activate(tabIdB), describe(tabIdA), describe(tabIdB)] as const;
      // Wait for late activations before propagating a rejection, so rollback includes them.
      await Promise.allSettled(attempts);
      const [a, b, tabA, tabB] = await Promise.all(attempts);
      if (revision !== this.revision) throw new Error('Sync startup cancelled.');

      const rateResponse = await sendToEndpoint(tabIdB, {
        type: 'SYNC_RATE', payload: { action: 'ratechange', rate: a.playbackRate, position: 0, timestamp: Date.now(), generation: 0 },
      }, b.frameId);
      if (!rateResponse.success) throw new Error('The second player could not match the playback speed.');
      // Align play/pause state without changing the two user-selected starting positions.
      if (a.paused !== b.paused) {
        const stateResponse = await sendToEndpoint(tabIdB, {
          type: a.paused ? 'SYNC_PAUSE' : 'SYNC_PLAY',
          payload: { action: a.paused ? 'pause' : 'play', position: -1, timestamp: Date.now(), generation: 0 },
        }, b.frameId);
        if (!stateResponse.success) throw new Error('Press play in both tabs, then try starting sync again.');
      }
      if (revision !== this.revision) throw new Error('Sync startup cancelled.');
      for (const [tabId, meta] of [[tabIdA, tabA], [tabIdB, tabB]] as const) {
        // mpv's title is known once it has activated.
        this.coordinator.setTabMeta(tabId, meta?.title ?? mpv.title, meta?.domain ?? 'mpv');
      }
      this.coordinator.startSync({ tabId: tabIdA, frameId: a.frameId }, { tabId: tabIdB, frameId: b.frameId }, {
        currentTimeA: a.currentTime, currentTimeB: b.currentTime,
        timestampA: a.timestamp, timestampB: b.timestamp,
        rateA: a.playbackRate, rateB: b.playbackRate,
        pausedA: a.paused, pausedB: b.paused, bufferingA: a.buffering, bufferingB: b.buffering,
      });
    } catch (error) {
      await Promise.allSettled(attempted.map(({ tabId, frameId }) => sendToEndpoint(tabId, { type: 'SYNC_DEACTIVATE' }, frameId)));
      throw error;
    }
  }
}
