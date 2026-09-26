import { SYNC, NUDGE_STEPS } from './sync-types';
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
import { withTimeout } from './async-utils';

const COMMAND_TYPE: Record<'pause' | 'play' | 'seek' | 'ratechange', MessageType> = {
  pause: 'SYNC_PAUSE',
  play: 'SYNC_PLAY',
  seek: 'SYNC_SEEK',
  ratechange: 'SYNC_RATE',
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
  private driftCheckRunning = false;
  private driftInterval: ReturnType<typeof setInterval> | null = null;
  private bufferStableTimers = new Map<'A' | 'B', ReturnType<typeof setTimeout>>();
  private tabMeta = new Map<number, { title: string; domain: string }>();
  private sendFailures = new Map<string, number>();
  private storageWrites: Promise<void> = Promise.resolve();
  private static readonly MAX_SEND_FAILURES = 5;

  // Wait for session recovery before handling messages after worker restart.
  private readyResolver!: () => void;
  ready: Promise<void> = new Promise<void>((resolve) => {
    this.readyResolver = resolve;
  });

  private extrapolate(p: SyncPositionResponse, now: number): number {
    if (p.paused || p.buffering) return p.currentTime;
    return p.currentTime + p.playbackRate * (now - p.timestamp) / 1000;
  }

  startSync(
    videoA: TabRef,
    videoB: TabRef,
    initialPositions: {
      currentTimeA: number;
      currentTimeB: number;
      timestampA?: number;
      timestampB?: number;
      rateA?: number;
      rateB?: number;
      pausedA?: boolean;
      pausedB?: boolean;
      bufferingA?: boolean;
      bufferingB?: boolean;
    }
  ): void {
    if (videoA.tabId === videoB.tabId || ![videoA.tabId, videoB.tabId].every(id => Number.isInteger(id) && id >= 0)
      || !Number.isFinite(initialPositions.currentTimeA) || !Number.isFinite(initialPositions.currentTimeB)) {
      throw new Error('Select two different tabs with valid media positions.');
    }
    this.stopSync('new session starting');
    for (const tabId of this.tabMeta.keys()) {
      if (tabId !== videoA.tabId && tabId !== videoB.tabId) this.tabMeta.delete(tabId);
    }

    // Compare activation samples at a common time so read skew does not affect the offset.
    const tsA = initialPositions.timestampA ?? Date.now();
    const tsB = initialPositions.timestampB ?? tsA;
    const refTime = Math.max(tsA, tsB);
    const adjA = this.extrapolate(
      {
        currentTime: initialPositions.currentTimeA,
        paused: initialPositions.pausedA ?? false,
        buffering: initialPositions.bufferingA ?? false,
        playbackRate: initialPositions.rateA ?? 1.0,
        timestamp: tsA,
      },
      refTime
    );
    const adjB = this.extrapolate(
      {
        currentTime: initialPositions.currentTimeB,
        paused: initialPositions.pausedB ?? false,
        buffering: initialPositions.bufferingB ?? false,
        playbackRate: initialPositions.rateB ?? 1.0,
        timestamp: tsB,
      },
      refTime
    );

    this.session = {
      videoA: { tabId: videoA.tabId, frameId: videoA.frameId },
      videoB: { tabId: videoB.tabId, frameId: videoB.frameId },
      offset: adjB - adjA,
      nudgeStep: SYNC.DEFAULT_NUDGE_STEP,
      generation: 0,
      bufferingTab: null,
    };
    this.sendFailures.clear();

    this.startDriftCorrection();
    void this.persistSession();
    if (initialPositions.bufferingA) void this.handleBufferingStart('A', videoB.tabId, {
      action: 'buffering_start', position: adjA, timestamp: refTime,
    });
    if (initialPositions.bufferingB) void this.handleBufferingStart('B', videoA.tabId, {
      action: 'buffering_start', position: adjB, timestamp: refTime,
    });
    logger.debug('Sync session started', {
      tabA: videoA.tabId,
      tabB: videoB.tabId,
      offset: this.session.offset,
    });
  }

  // Session storage survives worker restarts and clears when the browser exits.
  async restoreSession(): Promise<void> {
    try {
      const stored = await browser.storage.session.get(SYNC.STORAGE_KEY);
      const state = stored[SYNC.STORAGE_KEY] as PersistedSyncState | undefined;
      if (!state || !state.session) return;
      const session = state.session;
      const validEndpoint = (endpoint: SyncSession['videoA'] | undefined) => endpoint && Number.isInteger(endpoint.tabId) && endpoint.tabId >= 0
        && (endpoint.frameId == null || (Number.isInteger(endpoint.frameId) && endpoint.frameId >= 0));
      if (!validEndpoint(session.videoA) || !validEndpoint(session.videoB) || session.videoA.tabId === session.videoB.tabId
        || ![null, 'A', 'B', 'both'].includes(session.bufferingTab)
        || !Number.isFinite(session.offset) || !Number.isInteger(session.generation) || !NUDGE_STEPS.includes(session.nudgeStep)) {
        await this.clearPersistedSession();
        return;
      }

      this.session = state.session;
      this.tabMeta = new Map(Array.isArray(state.tabMeta) ? state.tabMeta.filter(entry => Array.isArray(entry) && typeof entry[1]?.title === 'string' && typeof entry[1]?.domain === 'string') : []);
      this.sendFailures.clear();
      this.startDriftCorrection();
      logger.debug('Sync session restored after SW restart', {
        tabA: this.session.videoA.tabId,
        tabB: this.session.videoB.tabId,
        offset: this.session.offset,
      });
    } catch (error) {
      logger.error('Failed to restore sync session:', error);
    } finally {
      this.readyResolver();
    }
  }

  private persistSession(): Promise<void> {
    if (!this.session) return Promise.resolve();
    const state: PersistedSyncState = {
      session: structuredClone(this.session),
      tabMeta: [...this.tabMeta.entries()],
    };
    this.storageWrites = this.storageWrites.then(() => browser.storage.session.set({ [SYNC.STORAGE_KEY]: state })).catch((error) => {
      logger.error('Failed to persist sync session:', error);
    });
    return this.storageWrites;
  }

  private clearPersistedSession(): Promise<void> {
    this.storageWrites = this.storageWrites.then(() => browser.storage.session.remove(SYNC.STORAGE_KEY)).catch((error) => {
      logger.error('Failed to clear persisted sync session:', error);
    });
    return this.storageWrites;
  }

  stopSync(reason?: string): Promise<void> {
    const wasActive = !!this.session;
    if (this.driftInterval) {
      clearInterval(this.driftInterval);
      this.driftInterval = null;
    }
    for (const timer of this.bufferStableTimers.values()) {
      clearTimeout(timer);
    }
    this.bufferStableTimers.clear();

    const tabAId = this.session?.videoA.tabId;
    const tabBId = this.session?.videoB.tabId;
    const frameAId = this.session?.videoA.frameId;
    const frameBId = this.session?.videoB.frameId;
    this.session = null; // null first to prevent re-entry from sendToTab error handler
    this.sendFailures.clear();

    const pending: Promise<unknown>[] = [this.clearPersistedSession()];
    if (tabAId != null) pending.push(this.sendToTab(tabAId, { type: 'SYNC_DEACTIVATE' }, frameAId));
    if (tabBId != null) pending.push(this.sendToTab(tabBId, { type: 'SYNC_DEACTIVATE' }, frameBId));

    if (wasActive) {
      logger.debug(`Sync session stopped. Reason: ${reason ?? 'unknown'}`);
    }
    return Promise.allSettled(pending).then(() => {});
  }

  nudgeOffset(delta: number): void {
    if (!this.session || !Number.isFinite(delta)) return;
    this.session.offset += delta;
    this.session.generation++;
    void this.persistSession();
    logger.debug('Offset nudged', { newOffset: this.session.offset });
    // Apply nudges immediately instead of waiting for gradual drift correction.
    void this.realignB();
  }

  // Discard realignments superseded by a later nudge or user action.
  private async realignB(): Promise<void> {
    if (!this.session) return;
    const gen = this.session.generation;
    const sessionAtRequest = this.session;
    const posA = await this.requestPosition(this.session.videoA.tabId);
    if (!posA) return;
    if (this.session !== sessionAtRequest || this.session.generation !== gen) return;

    const correctedA = this.extrapolate(posA, Date.now());
    const targetB = Math.max(0, correctedA + this.session.offset);

    await this.sendToSyncedTab(this.session.videoB.tabId, {
      type: 'SYNC_DRIFT_CORRECT',
      payload: {
        position: targetB,
        method: 'seek',
      } satisfies DriftCorrectPayload,
    });
  }

  async setNudgeStep(step: number): Promise<void> {
    if (!this.session) throw new Error('The sync session has ended.');
    if (!NUDGE_STEPS.includes(step)) throw new Error('Choose a valid nudge step.');
    this.session.nudgeStep = step;
    await this.persistSession();
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

  private getFrameId(tabId: number): number | undefined {
    if (!this.session) return undefined;
    if (tabId === this.session.videoA.tabId) return this.session.videoA.frameId;
    if (tabId === this.session.videoB.tabId) return this.session.videoB.frameId;
    return undefined;
  }

  private async sendToSyncedTab(tabId: number, message: HareMessage): Promise<unknown> {
    return this.sendToTab(tabId, message, this.getFrameId(tabId));
  }

  async handleSyncEvent(fromTabId: number, event: SyncEventPayload, fromFrameId?: number): Promise<void> {
    await this.ready;
    if (!this.session) return;
    if (!event || !Number.isFinite(event.position) || !Number.isFinite(event.timestamp)
      || (event.rate != null && (!Number.isFinite(event.rate) || event.rate <= 0))) return;

    const sourceSide = this.syncedSide(fromTabId, fromFrameId);
    if (!sourceSide) return;

    const targetTabId = sourceSide === 'A'
      ? this.session.videoB.tabId
      : this.session.videoA.tabId;

    switch (event.action) {
      case 'pause':
      case 'play':
      case 'seek': {
        if (event.action === 'pause') {
          // A deliberate pause cancels automatic resume after buffering.
          this.session.bufferingTab = null;
          for (const timer of this.bufferStableTimers.values()) clearTimeout(timer);
          this.bufferStableTimers.clear();
        }
        this.session.generation++;
        void this.persistSession();
        const targetPosition = this.toTargetPosition(sourceSide, event.position);
        await this.sendToSyncedTab(targetTabId, {
          type: COMMAND_TYPE[event.action],
          payload: {
            action: event.action,
            position: targetPosition,
            timestamp: event.timestamp,
            generation: this.session.generation,
            rate: event.rate,
          } satisfies SyncCommandPayload,
        });
        break;
      }

      case 'ratechange': {
        if (event.rate == null) break;
        this.session.generation++;
        void this.persistSession();
        await this.sendToSyncedTab(targetTabId, {
          type: COMMAND_TYPE.ratechange,
          payload: {
            action: 'ratechange',
            position: 0,
            timestamp: event.timestamp,
            generation: this.session.generation,
            rate: event.rate,
          } satisfies SyncCommandPayload,
        });
        break;
      }

      case 'buffering_start':
        await this.handleBufferingStart(sourceSide, targetTabId, event);
        break;

      case 'buffering_end':
        this.handleBufferingEnd(sourceSide);
        break;
    }
  }

  private toTargetPosition(fromSide: 'A' | 'B', position: number): number {
    if (!this.session) return Math.max(0, position);
    const { offset } = this.session;
    const delta = fromSide === 'A' ? offset : -offset;
    return Math.max(0, position + delta);
  }

  /** Converts a position, returning -1 when the current offset can't be maintained. */
  private toTargetPositionOrNoSeek(fromSide: 'A' | 'B', position: number): number {
    if (!this.session) return Math.max(0, position);
    const { offset } = this.session;
    const delta = fromSide === 'A' ? offset : -offset;
    const target = position + delta;
    return target < 0 ? -1 : target;
  }

  private syncedSide(tabId: number, frameId?: number): 'A' | 'B' | null {
    if (!this.session) return null;
    const { videoA, videoB } = this.session;
    if (this.matchesEndpoint(videoA, tabId, frameId)) return 'A';
    if (this.matchesEndpoint(videoB, tabId, frameId)) return 'B';
    return null;
  }

  hasEndpoint(tabId: number, frameId?: number): boolean {
    return this.syncedSide(tabId, frameId) !== null;
  }

  private matchesEndpoint(ref: TabRef, tabId: number, frameId?: number): boolean {
    if (ref.tabId !== tabId) return false;
    return ref.frameId == null || frameId == null || ref.frameId === frameId;
  }

  private isBuffering(side: 'A' | 'B'): boolean {
    return this.session?.bufferingTab === side || this.session?.bufferingTab === 'both';
  }

  private async handleBufferingStart(
    fromSide: 'A' | 'B',
    targetTabId: number,
    event: SyncEventPayload,
  ): Promise<void> {
    if (!this.session) return;
    clearTimeout(this.bufferStableTimers.get(fromSide));
    this.bufferStableTimers.delete(fromSide);
    if (this.isBuffering(fromSide)) return;

    this.session.bufferingTab = this.session.bufferingTab === null ? fromSide : 'both';
    this.session.generation++;
    void this.persistSession();
    await this.sendToSyncedTab(targetTabId, {
      type: 'SYNC_PAUSE',
      payload: {
        action: 'pause',
        buffering: true,
        position: this.toTargetPositionOrNoSeek(fromSide, event.position),
        timestamp: event.timestamp,
        generation: this.session.generation,
      } satisfies SyncCommandPayload,
    });
  }

  private handleBufferingEnd(fromSide: 'A' | 'B'): void {
    if (!this.isBuffering(fromSide) || this.bufferStableTimers.has(fromSide)) return;
    const session = this.session!;
    this.bufferStableTimers.set(fromSide, setTimeout(() => {
      this.bufferStableTimers.delete(fromSide);
      if (this.session !== session || !this.isBuffering(fromSide)) return;
      session.bufferingTab = session.bufferingTab === 'both' ? (fromSide === 'A' ? 'B' : 'A') : null;
      session.generation++;
      void this.persistSession();
      if (session.bufferingTab !== null) return;

      const msg: HareMessage = {
        type: 'SYNC_PLAY',
        payload: { action: 'play', position: -1, timestamp: Date.now(), generation: session.generation } satisfies SyncCommandPayload,
      };
      void this.sendToSyncedTab(session.videoA.tabId, msg);
      void this.sendToSyncedTab(session.videoB.tabId, msg);
    }, SYNC.BUFFERING_STABLE_MS));
  }

  private startDriftCorrection(): void {
    this.driftInterval = setInterval(() => {
      this.checkDrift();
    }, SYNC.DRIFT_CHECK_INTERVAL_MS);
  }

  private async checkDrift(): Promise<void> {
    if (!this.session || this.driftCheckRunning) return;
    this.driftCheckRunning = true;

    const generationAtCheck = this.session.generation;
    const sessionAtCheck = this.session;

    try {
      const [posA, posB] = await Promise.all([
        this.requestPosition(this.session.videoA.tabId),
        this.requestPosition(this.session.videoB.tabId),
      ]);

      if (!posA || !posB) return;
      if (this.session !== sessionAtCheck || this.session.generation !== generationAtCheck) return;
      // Keep checking during buffering: recovery events can be lost during worker restart.
      for (const [side, position, target] of [
        ['A', posA, sessionAtCheck.videoB.tabId],
        ['B', posB, sessionAtCheck.videoA.tabId],
      ] as const) {
        if (position.buffering) {
          void this.handleBufferingStart(side, target, {
            action: 'buffering_start', position: position.currentTime, timestamp: position.timestamp,
          });
        } else this.handleBufferingEnd(side);
      }
      if (sessionAtCheck.bufferingTab !== null || posA.buffering || posB.buffering) return;
      // Pause/play events reconcile paused players; drift correction cannot.
      if (posA.paused || posB.paused) return;

      const now = Date.now();
      const correctedA = this.extrapolate(posA, now);
      const correctedB = this.extrapolate(posB, now);

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
    } finally {
      this.driftCheckRunning = false;
    }
  }

  private async requestPosition(tabId: number): Promise<SyncPositionResponse | null> {
    return await this.sendToSyncedTab(tabId, { type: 'SYNC_GET_POSITION' }) as SyncPositionResponse | null;
  }

  private async sendToTab(tabId: number, message: HareMessage, frameId?: number): Promise<unknown> {
    const sessionAtSend = this.session;
    try {
      const result = await withTimeout(frameId != null
        ? browser.tabs.sendMessage(tabId, message, { frameId })
        : browser.tabs.sendMessage(tabId, message), message.type === 'SYNC_GET_POSITION' ? SYNC.POSITION_TIMEOUT_MS : undefined);
      if (sessionAtSend !== this.session) return null;
      if (this.isFailedResponse(message, result)) {
        this.recordSendFailure(tabId, frameId, result);
        return null;
      }
      this.clearSendFailure(tabId, frameId);
      return result;
    } catch (error) {
      if (sessionAtSend === this.session) this.recordSendFailure(tabId, frameId, error);
      return null;
    }
  }

  private endpointKey(tabId: number, frameId?: number): string {
    return `${tabId}:${frameId ?? 'all'}`;
  }

  private isSyncedEndpoint(tabId: number): boolean {
    return !!this.session && (
      tabId === this.session.videoA.tabId ||
      tabId === this.session.videoB.tabId
    );
  }

  private clearSendFailure(tabId: number, frameId?: number): void {
    this.sendFailures.delete(this.endpointKey(tabId, frameId));
  }

  private isFailedResponse(message: HareMessage, result: unknown): boolean {
    if (message.type === 'SYNC_DEACTIVATE') return false;
    if (result == null || typeof result !== 'object') return true;

    const record = result as Record<string, unknown>;
    if (record.success === false) return true;

    if (message.type === 'SYNC_GET_POSITION') {
      return !(
        this.isFiniteNumber(record.currentTime) && record.currentTime >= 0 &&
        typeof record.paused === 'boolean' && typeof record.buffering === 'boolean' &&
        this.isFiniteNumber(record.playbackRate) && record.playbackRate > 0 &&
        this.isFiniteNumber(record.timestamp) && record.timestamp >= 0
      );
    }

    return record.success !== true;
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private recordSendFailure(
    tabId: number,
    frameId: number | undefined,
    reason: unknown
  ): void {
    if (!this.isSyncedEndpoint(tabId)) return;

    const key = this.endpointKey(tabId, frameId);
    const failures = (this.sendFailures.get(key) ?? 0) + 1;
    this.sendFailures.set(key, failures);
    logger.warn(`Send to tab ${tabId} failed (${failures}/${SyncCoordinator.MAX_SEND_FAILURES}):`, reason);
    if (failures >= SyncCoordinator.MAX_SEND_FAILURES) {
      void this.stopSync(`tab ${tabId} stopped responding`);
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
