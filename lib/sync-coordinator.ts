import { SYNC } from './sync-types';
import type {
  SyncSession,
  SyncEventPayload,
  SyncCommandPayload,
  DriftCorrectPayload,
  SyncStatusResponse,
  SyncPositionResponse,
} from './sync-types';
import type { HareMessage, MessageType } from './types';
import { logger } from './logger';

const COMMAND_TYPE: Record<'pause' | 'play' | 'seek', MessageType> = {
  pause: 'SYNC_PAUSE',
  play: 'SYNC_PLAY',
  seek: 'SYNC_SEEK',
};

interface TabRef {
  tabId: number;
  frameId?: number;
}

interface PersistedSyncState {
  session: SyncSession;
  tabMeta: Array<[number, { title: string; domain: string }]>;
}

export class SyncCoordinator {
  private session: SyncSession | null = null;
  private driftInterval: ReturnType<typeof setInterval> | null = null;
  private bufferStableTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private tabMeta = new Map<number, { title: string; domain: string }>();
  private sendFailures = 0;
  private static readonly MAX_SEND_FAILURES = 5;

  startSync(
    videoA: TabRef,
    videoB: TabRef,
    initialPositions: { currentTimeA: number; currentTimeB: number }
  ): void {
    this.stopSync('new session starting');

    this.session = {
      videoA: { tabId: videoA.tabId, frameId: videoA.frameId },
      videoB: { tabId: videoB.tabId, frameId: videoB.frameId },
      offset: initialPositions.currentTimeB - initialPositions.currentTimeA,
      nudgeStep: SYNC.DEFAULT_NUDGE_STEP,
      generation: 0,
      bufferingTab: null,
    };
    this.sendFailures = 0;

    this.startDriftCorrection();
    void this.persistSession();
    logger.warn('Sync session started', {
      tabA: videoA.tabId,
      tabB: videoB.tabId,
      offset: this.session.offset,
    });
  }

  /**
   * Restore a previously persisted session from chrome.storage.session.
   * Called once on background service-worker startup so that an in-progress
   * sync session survives SW termination/respawn (the in-memory `session`
   * field is otherwise lost). chrome.storage.session is wiped on browser
   * restart, which is the correct scope: we want to recover from SW death,
   * not from full browser exit.
   */
  async restoreSession(): Promise<void> {
    try {
      const stored = await browser.storage.session.get(SYNC.STORAGE_KEY);
      const state = stored[SYNC.STORAGE_KEY] as PersistedSyncState | undefined;
      if (!state || !state.session) return;

      this.session = state.session;
      this.tabMeta = new Map(state.tabMeta ?? []);
      this.sendFailures = 0;
      // bufferingTab state from before SW death is no longer reliable —
      // both tabs have continued running independently. Reset it.
      this.session.bufferingTab = null;
      this.startDriftCorrection();
      logger.warn('Sync session restored after SW restart', {
        tabA: this.session.videoA.tabId,
        tabB: this.session.videoB.tabId,
        offset: this.session.offset,
      });
    } catch (error) {
      logger.error('Failed to restore sync session:', error);
    }
  }

  private persistSession(): Promise<void> {
    if (!this.session) return Promise.resolve();
    const state: PersistedSyncState = {
      session: this.session,
      tabMeta: [...this.tabMeta.entries()],
    };
    return browser.storage.session.set({ [SYNC.STORAGE_KEY]: state }).catch((error) => {
      logger.error('Failed to persist sync session:', error);
    });
  }

  private clearPersistedSession(): Promise<void> {
    return browser.storage.session.remove(SYNC.STORAGE_KEY).catch((error) => {
      logger.error('Failed to clear persisted sync session:', error);
    });
  }

  stopSync(reason?: string): void {
    const wasActive = !!this.session;
    if (this.driftInterval) {
      clearInterval(this.driftInterval);
      this.driftInterval = null;
    }
    for (const timer of this.bufferStableTimers.values()) {
      clearTimeout(timer);
    }
    this.bufferStableTimers.clear();

    // Capture tab+frame ids before nulling session to prevent re-entrant loops
    const tabAId = this.session?.videoA.tabId;
    const tabBId = this.session?.videoB.tabId;
    const frameAId = this.session?.videoA.frameId;
    const frameBId = this.session?.videoB.frameId;
    this.session = null; // null first to prevent re-entry from sendToTab error handler

    if (tabAId != null) this.sendToTab(tabAId, { type: 'SYNC_DEACTIVATE' }, frameAId);
    if (tabBId != null) this.sendToTab(tabBId, { type: 'SYNC_DEACTIVATE' }, frameBId);

    void this.clearPersistedSession();

    if (wasActive) {
      logger.warn(`Sync session stopped. Reason: ${reason ?? 'unknown'}`);
    }
  }

  nudgeOffset(delta: number): void {
    if (!this.session) return;
    this.session.offset += delta;
    this.session.generation++;
    void this.persistSession();
    logger.debug('Offset nudged', { newOffset: this.session.offset });
    // Apply the new offset actively so the user sees an instant jump rather
    // than waiting up to 2s for the next drift tick (and then only receiving
    // partial correction when the delta is below the rate-adjust threshold).
    void this.realignB();
  }

  /**
   * Hard-seek B to match A's current position under the *current* session
   * offset. Generation is checked so a stale realignment (superseded by a
   * later nudge or user action) is dropped.
   */
  private async realignB(): Promise<void> {
    if (!this.session) return;
    const gen = this.session.generation;
    const posA = await this.requestPosition(this.session.videoA.tabId);
    if (!posA) return;
    if (!this.session || this.session.generation !== gen) return;

    const correctedA = posA.currentTime + (Date.now() - posA.timestamp) / 1000;
    const targetB = Math.max(0, correctedA + this.session.offset);

    await this.sendToSyncedTab(this.session.videoB.tabId, {
      type: 'SYNC_DRIFT_CORRECT',
      payload: {
        position: targetB,
        generation: gen,
        method: 'seek',
      } satisfies DriftCorrectPayload,
    });
  }

  setNudgeStep(step: number): void {
    if (!this.session) return;
    this.session.nudgeStep = step;
    void this.persistSession();
  }

  setTabMeta(tabId: number, title: string, domain: string): void {
    this.tabMeta.set(tabId, { title, domain });
    if (this.session) void this.persistSession();
  }

  getStatus(): SyncStatusResponse {
    if (!this.session) {
      return { active: false, videoA: null, videoB: null, offset: 0, nudgeStep: SYNC.DEFAULT_NUDGE_STEP };
    }

    const metaA = this.tabMeta.get(this.session.videoA.tabId);
    const metaB = this.tabMeta.get(this.session.videoB.tabId);

    return {
      active: true,
      videoA: metaA
        ? { tabId: this.session.videoA.tabId, ...metaA }
        : { tabId: this.session.videoA.tabId, title: 'Tab A', domain: '' },
      videoB: metaB
        ? { tabId: this.session.videoB.tabId, ...metaB }
        : { tabId: this.session.videoB.tabId, title: 'Tab B', domain: '' },
      offset: this.session.offset,
      nudgeStep: this.session.nudgeStep,
    };
  }

  /**
   * Resolve the frameId for a given tabId from the session.
   * Note: assumes each synced tab is unique. If the same tab were used for both
   * videos, videoA's frameId would always be returned. This is an accepted
   * limitation since same-tab sync is not a supported use case.
   */
  private getFrameId(tabId: number): number | undefined {
    if (!this.session) return undefined;
    if (tabId === this.session.videoA.tabId) return this.session.videoA.frameId;
    if (tabId === this.session.videoB.tabId) return this.session.videoB.frameId;
    return undefined;
  }

  /** Send to the correct frame within a synced tab */
  private async sendToSyncedTab(tabId: number, message: HareMessage): Promise<unknown> {
    return this.sendToTab(tabId, message, this.getFrameId(tabId));
  }

  async handleSyncEvent(fromTabId: number, event: SyncEventPayload): Promise<void> {
    if (!this.session) return;

    const targetTabId = this.peerTabId(fromTabId);
    if (targetTabId == null) return;
    const targetPosition = this.toTargetPosition(fromTabId, event.position);

    switch (event.action) {
      case 'pause':
      case 'play':
      case 'seek':
        this.session.generation++;
        await this.sendToSyncedTab(targetTabId, {
          type: COMMAND_TYPE[event.action],
          payload: {
            action: event.action,
            position: targetPosition,
            timestamp: event.timestamp,
            generation: this.session.generation,
          } satisfies SyncCommandPayload,
        });
        break;

      case 'buffering_start':
        await this.handleBufferingStart(fromTabId, targetTabId, event);
        break;

      case 'buffering_end':
        await this.handleBufferingEnd(fromTabId);
        break;
    }
  }

  /** Convert a position on `fromTabId` to the equivalent position on the other tab. */
  private toTargetPosition(fromTabId: number, position: number): number {
    if (!this.session) return Math.max(0, position);
    const { videoA, offset } = this.session;
    const delta = fromTabId === videoA.tabId ? offset : -offset;
    return Math.max(0, position + delta);
  }

  private peerTabId(fromTabId: number): number | null {
    if (!this.session) return null;
    const { videoA, videoB } = this.session;
    if (fromTabId === videoA.tabId) return videoB.tabId;
    if (fromTabId === videoB.tabId) return videoA.tabId;
    return null;
  }

  private async handleBufferingStart(
    fromTabId: number,
    targetTabId: number,
    event: SyncEventPayload
  ): Promise<void> {
    if (!this.session) return;

    const fromSide = fromTabId === this.session.videoA.tabId ? 'A' : 'B';

    const existingTimer = this.bufferStableTimers.get(fromTabId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.bufferStableTimers.delete(fromTabId);
    }

    if (this.session.bufferingTab === null) {
      this.session.bufferingTab = fromSide;
      await this.sendToSyncedTab(targetTabId, {
        type: 'SYNC_PAUSE',
        payload: {
          action: 'pause',
          position: this.toTargetPosition(fromTabId, event.position),
          timestamp: event.timestamp,
          generation: this.session.generation,
        } satisfies SyncCommandPayload,
      });
    } else if (this.session.bufferingTab !== fromSide) {
      this.session.bufferingTab = 'both';
    }
  }

  private async handleBufferingEnd(fromTabId: number): Promise<void> {
    if (!this.session) return;

    const fromSide = fromTabId === this.session.videoA.tabId ? 'A' : 'B';

    this.bufferStableTimers.set(
      fromTabId,
      setTimeout(async () => {
        this.bufferStableTimers.delete(fromTabId);
        if (!this.session) return;

        if (this.session.bufferingTab === 'both') {
          this.session.bufferingTab = fromSide === 'A' ? 'B' : 'A';
          return;
        }
        if (this.session.bufferingTab !== fromSide) return;

        this.session.bufferingTab = null;
        this.session.generation++;
        // position: -1 signals "resume without seeking"
        const payload: SyncCommandPayload = {
          action: 'play',
          position: -1,
          timestamp: Date.now(),
          generation: this.session.generation,
        };
        const msg: HareMessage = { type: 'SYNC_PLAY', payload };
        await Promise.all([
          this.sendToSyncedTab(this.session.videoA.tabId, msg),
          this.sendToSyncedTab(this.session.videoB.tabId, msg),
        ]);
      }, SYNC.BUFFERING_STABLE_MS)
    );
  }

  private startDriftCorrection(): void {
    this.driftInterval = setInterval(() => {
      this.checkDrift();
    }, SYNC.DRIFT_CHECK_INTERVAL_MS);
  }

  private async checkDrift(): Promise<void> {
    if (!this.session) return;
    if (this.session.bufferingTab !== null) return;

    const generationAtCheck = this.session.generation;

    try {
      const [posA, posB] = await Promise.all([
        this.requestPosition(this.session.videoA.tabId),
        this.requestPosition(this.session.videoB.tabId),
      ]);

      if (!posA || !posB) return;
      if (!this.session || this.session.generation !== generationAtCheck) return;
      if (posA.paused && posB.paused) return;

      const now = Date.now();
      const correctedA = posA.currentTime + (now - posA.timestamp) / 1000;
      const correctedB = posB.currentTime + (now - posB.timestamp) / 1000;

      const expectedB = correctedA + this.session.offset;
      const expectedA = correctedB - this.session.offset;

      // If either expected position is negative, the offset can't be maintained
      // at this position (one video is near its start). Don't fight the user.
      if (expectedB < 0 || expectedA < 0) return;

      const driftMs = (correctedB - expectedB) * 1000;
      const absDriftMs = Math.abs(driftMs);

      if (absDriftMs < SYNC.DRIFT_IGNORE_THRESHOLD_MS) return;

      const behindIsB = driftMs < 0;
      const behindTabId = behindIsB ? this.session.videoB.tabId : this.session.videoA.tabId;

      if (absDriftMs < SYNC.DRIFT_RATE_ADJUST_THRESHOLD_MS) {
        await this.sendToSyncedTab(behindTabId, {
          type: 'SYNC_DRIFT_CORRECT',
          payload: {
            position: 0,
            generation: generationAtCheck,
            method: 'rate',
            rateFactor: SYNC.RATE_ADJUST_FACTOR,
            durationMs: SYNC.RATE_ADJUST_DURATION_MS,
          } satisfies DriftCorrectPayload,
        });
      } else {
        await this.sendToSyncedTab(behindTabId, {
          type: 'SYNC_DRIFT_CORRECT',
          payload: {
            position: behindIsB ? expectedB : expectedA,
            generation: generationAtCheck,
            method: 'seek',
          } satisfies DriftCorrectPayload,
        });
      }

      logger.debug('Drift correction applied', {
        driftMs: Math.round(driftMs),
        method: absDriftMs < SYNC.DRIFT_RATE_ADJUST_THRESHOLD_MS ? 'rate' : 'seek',
        correctedTab: behindTabId,
      });
    } catch (error) {
      logger.error('Drift check failed:', error);
    }
  }

  private async requestPosition(tabId: number): Promise<SyncPositionResponse | null> {
    try {
      const response = await Promise.race([
        this.sendToSyncedTab(tabId, { type: 'SYNC_GET_POSITION' }),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), SYNC.POSITION_TIMEOUT_MS)
        ),
      ]);
      return response as SyncPositionResponse | null;
    } catch {
      return null;
    }
  }

  private async sendToTab(tabId: number, message: HareMessage, frameId?: number): Promise<unknown> {
    try {
      const result = frameId != null
        ? await browser.tabs.sendMessage(tabId, message, { frameId })
        : await browser.tabs.sendMessage(tabId, message);
      this.sendFailures = 0;
      return result;
    } catch (error) {
      if (
        this.session &&
        (tabId === this.session.videoA.tabId || tabId === this.session.videoB.tabId)
      ) {
        this.sendFailures++;
        logger.warn(`Send to tab ${tabId} failed (${this.sendFailures}/${SyncCoordinator.MAX_SEND_FAILURES}):`, error);
        if (this.sendFailures >= SyncCoordinator.MAX_SEND_FAILURES) {
          this.stopSync(`sendToTab failed ${this.sendFailures} times for tab ${tabId}, msg: ${message.type}, last error: ${error}`);
        }
      }
      return null;
    }
  }

  handleTabRemoved(tabId: number): void {
    if (!this.session) return;
    if (tabId === this.session.videoA.tabId || tabId === this.session.videoB.tabId) {
      this.stopSync(`tab ${tabId} was closed`);
    }
  }

  destroy(): void {
    this.stopSync('coordinator destroyed');
  }
}
