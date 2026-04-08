import { SYNC } from './sync-types';
import type {
  SyncSession,
  SyncEventPayload,
  SyncCommandPayload,
  DriftCorrectPayload,
  SyncStatusResponse,
  SyncPositionResponse,
} from './sync-types';
import { logger } from './logger';

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
    void this.persistSession();
    logger.debug('Offset nudged', { newOffset: this.session.offset });
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
  private async sendToSyncedTab(tabId: number, message: { type: string; payload?: unknown }): Promise<unknown> {
    return this.sendToTab(tabId, message, this.getFrameId(tabId));
  }

  async handleSyncEvent(fromTabId: number, event: SyncEventPayload): Promise<void> {
    if (!this.session) return;

    const { videoA, videoB } = this.session;
    let targetTabId: number;
    let targetPosition: number;

    if (fromTabId === videoA.tabId) {
      targetTabId = videoB.tabId;
      targetPosition = Math.max(0, event.position + this.session.offset);
    } else if (fromTabId === videoB.tabId) {
      targetTabId = videoA.tabId;
      targetPosition = Math.max(0, event.position - this.session.offset);
    } else {
      return; // Unknown tab
    }

    switch (event.action) {
      case 'pause':
        this.session.generation++;
        await this.sendToSyncedTab(targetTabId, {
          type: 'SYNC_PAUSE',
          payload: {
            action: 'pause',
            position: targetPosition,
            timestamp: event.timestamp,
            generation: this.session.generation,
          } satisfies SyncCommandPayload,
        });
        break;

      case 'play':
        this.session.generation++;
        await this.sendToSyncedTab(targetTabId, {
          type: 'SYNC_PLAY',
          payload: {
            action: 'play',
            position: targetPosition,
            timestamp: event.timestamp,
            generation: this.session.generation,
          } satisfies SyncCommandPayload,
        });
        break;

      case 'seek':
        this.session.generation++;
        await this.sendToSyncedTab(targetTabId, {
          type: 'SYNC_SEEK',
          payload: {
            action: 'seek',
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
        await this.handleBufferingEnd(fromTabId, targetTabId, event);
        break;
    }
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
      // Apply offset: convert source position to target position
      const targetPosition = Math.max(0, fromTabId === this.session.videoA.tabId
        ? event.position + this.session.offset
        : event.position - this.session.offset);
      await this.sendToSyncedTab(targetTabId, {
        type: 'SYNC_PAUSE',
        payload: {
          action: 'pause',
          position: targetPosition,
          timestamp: event.timestamp,
          generation: this.session.generation,
        } satisfies SyncCommandPayload,
      });
    } else if (this.session.bufferingTab !== fromSide) {
      this.session.bufferingTab = 'both';
    }
  }

  private async handleBufferingEnd(
    fromTabId: number,
    _targetTabId: number,
    _event: SyncEventPayload
  ): Promise<void> {
    if (!this.session) return;

    const fromSide = fromTabId === this.session.videoA.tabId ? 'A' : 'B';

    this.bufferStableTimers.set(
      fromTabId,
      setTimeout(async () => {
        this.bufferStableTimers.delete(fromTabId);
        if (!this.session) return;

        if (this.session.bufferingTab === 'both') {
          const otherSide = fromSide === 'A' ? 'B' : 'A';
          this.session.bufferingTab = otherSide;
        } else if (this.session.bufferingTab === fromSide) {
          this.session.bufferingTab = null;
          this.session.generation++;
          const gen = this.session.generation;
          const tabAId = this.session.videoA.tabId;
          const tabBId = this.session.videoB.tabId;
          const fAId = this.session.videoA.frameId;
          const fBId = this.session.videoB.frameId;

          // position: -1 signals "resume without seeking"
          await this.sendToTab(tabAId, {
            type: 'SYNC_PLAY',
            payload: {
              action: 'play',
              position: -1,
              timestamp: Date.now(),
              generation: gen,
            } satisfies SyncCommandPayload,
          }, fAId);
          await this.sendToTab(tabBId, {
            type: 'SYNC_PLAY',
            payload: {
              action: 'play',
              position: -1,
              timestamp: Date.now(),
              generation: gen,
            } satisfies SyncCommandPayload,
          }, fBId);
        }
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

    const requestId = Math.random().toString(36).slice(2);
    const generationAtCheck = this.session.generation;

    try {
      const [posA, posB] = await Promise.all([
        this.requestPosition(this.session.videoA.tabId, requestId + '_A', this.session.videoA.frameId),
        this.requestPosition(this.session.videoB.tabId, requestId + '_B', this.session.videoB.frameId),
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

      const behindTabId = driftMs < 0
        ? this.session.videoB.tabId
        : this.session.videoA.tabId;

      if (absDriftMs < SYNC.DRIFT_RATE_ADJUST_THRESHOLD_MS) {
        // Always speed up the behind tab (positive factor)
        const rateFactor = SYNC.RATE_ADJUST_FACTOR;
        await this.sendToSyncedTab(behindTabId, {
          type: 'SYNC_DRIFT_CORRECT',
          payload: {
            position: 0,
            generation: generationAtCheck,
            method: 'rate',
            rateFactor,
            durationMs: SYNC.RATE_ADJUST_DURATION_MS,
          } satisfies DriftCorrectPayload,
        });
      } else {
        const targetPosition = behindTabId === this.session.videoB.tabId
          ? expectedB
          : correctedB - this.session.offset;

        await this.sendToSyncedTab(behindTabId, {
          type: 'SYNC_DRIFT_CORRECT',
          payload: {
            position: targetPosition,
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

  private async requestPosition(
    tabId: number,
    requestId: string,
    frameId?: number
  ): Promise<SyncPositionResponse | null> {
    try {
      const response = await Promise.race([
        this.sendToTab(tabId, {
          type: 'SYNC_GET_POSITION',
          payload: { requestId },
        }, frameId),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), SYNC.POSITION_TIMEOUT_MS)
        ),
      ]);
      return response as SyncPositionResponse | null;
    } catch {
      return null;
    }
  }

  private async sendToTab(tabId: number, message: { type: string; payload?: unknown }, frameId?: number): Promise<unknown> {
    try {
      let result;
      if (frameId != null) {
        result = await browser.tabs.sendMessage(tabId, message, { frameId });
      } else {
        result = await browser.tabs.sendMessage(tabId, message);
      }
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
