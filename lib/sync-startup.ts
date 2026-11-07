import { isEndpointId } from './sync-types';
import { describeEndpoint, endpointFrames, sendToEndpoint } from './sync-transport';
import type { SyncCoordinator } from './sync-coordinator';
import type { SyncPositionResponse } from './sync-types';

interface Activation extends SyncPositionResponse { frameId: number; }

export class SyncStartup {
  private revision = 0;
  private pending: Promise<void> | null = null;

  constructor(private coordinator: Pick<SyncCoordinator, 'ready' | 'stopSync' | 'startSync'>) {}

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
      await this.coordinator.stopSync('replacing session');
      if (revision !== this.revision) throw new Error('Sync startup cancelled.');
      const activate = async (tabId: number): Promise<Activation> => {
        for (const frameId of await endpointFrames(tabId)) {
          if (revision !== this.revision) throw new Error('Sync startup cancelled.');
          attempted.push({ tabId, frameId });
          try {
            const result = await sendToEndpoint(tabId, { type: 'SYNC_ACTIVATE' }, frameId);
            if (result.success) return { ...result, frameId };
          } catch { /* Try the next frame. All attempted frames are cleaned up on failure. */ }
        }
        throw new Error('A selected tab has no available media. Reload it and refresh the tab list.');
      };
      const attempts = [activate(tabIdA), activate(tabIdB)] as const;
      await Promise.allSettled(attempts);
      const [a, b] = await Promise.all(attempts);
      if (revision !== this.revision) throw new Error('Sync startup cancelled.');

      const rateResponse = await sendToEndpoint(tabIdB, {
        type: 'SYNC_RATE', payload: { rate: a.playbackRate, position: 0, timestamp: Date.now() },
      }, b.frameId);
      if (!rateResponse.success) throw new Error('The second player could not match the playback speed.');
      if (a.paused !== b.paused) {
        const stateResponse = await sendToEndpoint(tabIdB, {
          type: a.paused ? 'SYNC_PAUSE' : 'SYNC_PLAY',
          payload: { position: -1, timestamp: Date.now() },
        }, b.frameId);
        if (!stateResponse.success) throw new Error('Press play in both tabs, then try starting sync again.');
      }
      if (revision !== this.revision) throw new Error('Sync startup cancelled.');
      const [metaA, metaB] = await Promise.all([describeEndpoint(tabIdA), describeEndpoint(tabIdB)]);
      if (revision !== this.revision) throw new Error('Sync startup cancelled.');
      await this.coordinator.startSync(
        { endpoint: { tabId: tabIdA, frameId: a.frameId }, position: a, ...metaA },
        { endpoint: { tabId: tabIdB, frameId: b.frameId }, position: b, ...metaB },
      );
    } catch (error) {
      await Promise.allSettled(attempted.map(({ tabId, frameId }) => sendToEndpoint(tabId, { type: 'SYNC_DEACTIVATE' }, frameId)));
      throw error;
    }
  }
}
