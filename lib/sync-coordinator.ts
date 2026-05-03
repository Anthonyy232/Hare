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
  private driftInterval: ReturnType<typeof setInterval> | null = null;
  private bufferStableTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private tabMeta = new Map<number, { title: string; domain: string }>();
  private sendFailures = new Map<string, number>();
  private static readonly MAX_SEND_FAILURES = 5;

  /**
   * Resolves once restoreSession() has finished (success or failure). Inbound
   * event handlers await this so messages received during SW respawn aren't
   * silently dropped while session state is still rehydrating.
   */
  private readyResolver!: () => void;
  ready: Promise<void> = new Promise<void>((resolve) => {
    this.readyResolver = resolve;
  });

  /** Mark coordinator ready when no restore is needed (tests, fresh install). */
  markReady(): void {
    this.readyResolver();
  }

  /** Rate- and paused-aware extrapolation of a position to a reference time. */
  private extrapolate(p: SyncPositionResponse, now: number): number {
    if (p.paused) return p.currentTime;
    const rate = p.playbackRate ?? 1.0;
    return p.currentTime + rate * (now - p.timestamp) / 1000;
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
    }
  ): void {
    this.stopSync('new session starting');

    // Each SYNC_ACTIVATE returns currentTime read at that tab's local moment;
    // the two reads happen at different real-times. Extrapolate both to a
    // common reference time before computing the offset so measurement skew
    // doesn't get baked in.
    const tsA = initialPositions.timestampA ?? Date.now();
    const tsB = initialPositions.timestampB ?? tsA;
    const refTime = Math.max(tsA, tsB);
    const adjA = this.extrapolate(
      {
        currentTime: initialPositions.currentTimeA,
        paused: initialPositions.pausedA ?? false,
        playbackRate: initialPositions.rateA ?? 1.0,
        timestamp: tsA,
      },
      refTime
    );
    const adjB = this.extrapolate(
      {
        currentTime: initialPositions.currentTimeB,
        paused: initialPositions.pausedB ?? false,
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
      this.sendFailures.clear();
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
    } finally {
      this.readyResolver();
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
    this.sendFailures.clear();

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

  async handleSyncEvent(fromTabId: number, event: SyncEventPayload, fromFrameId?: number): Promise<void> {
    await this.ready;
    if (!this.session) return;

    const sourceSide = this.syncedSide(fromTabId, fromFrameId);
    if (!sourceSide) return;

    const targetTabId = sourceSide === 'A'
      ? this.session.videoB.tabId
      : this.session.videoA.tabId;

    switch (event.action) {
      case 'pause':
      case 'play':
      case 'seek': {
        this.session.generation++;
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
        await this.handleBufferingStart(fromTabId, fromFrameId, sourceSide, targetTabId, event);
        break;

      case 'buffering_end':
        await this.handleBufferingEnd(fromTabId, fromFrameId, sourceSide);
        break;
    }
  }

  /** Convert a position on one synced side to the equivalent position on the other side. */
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

  private matchesEndpoint(ref: TabRef, tabId: number, frameId?: number): boolean {
    if (ref.tabId !== tabId) return false;
    return ref.frameId == null || frameId == null || ref.frameId === frameId;
  }

  private async handleBufferingStart(
    fromTabId: number,
    fromFrameId: number | undefined,
    fromSide: 'A' | 'B',
    targetTabId: number,
    event: SyncEventPayload
  ): Promise<void> {
    if (!this.session) return;

    const timerKey = this.endpointKey(fromTabId, fromFrameId);
    const existingTimer = this.bufferStableTimers.get(timerKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.bufferStableTimers.delete(timerKey);
    }

    if (this.session.bufferingTab === null) {
      this.session.bufferingTab = fromSide;
      await this.sendToSyncedTab(targetTabId, {
        type: 'SYNC_PAUSE',
        payload: {
          action: 'pause',
          position: this.toTargetPositionOrNoSeek(fromSide, event.position),
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
    fromFrameId: number | undefined,
    fromSide: 'A' | 'B'
  ): Promise<void> {
    if (!this.session) return;

    const timerKey = this.endpointKey(fromTabId, fromFrameId);
    this.bufferStableTimers.set(
      timerKey,
      setTimeout(async () => {
        this.bufferStableTimers.delete(timerKey);
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
      // If both are paused there's nothing to drift. If one is paused and the
      // other isn't, the playing side will diverge unboundedly until the next
      // pause/play event reconciles — correcting either side is meaningless.
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
      if (this.isFailedResponse(message, result)) {
        this.recordSendFailure(tabId, frameId, message, result);
        return null;
      }
      this.clearSendFailure(tabId, frameId);
      return result;
    } catch (error) {
      this.recordSendFailure(tabId, frameId, message, error);
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
    if (result == null) return true;
    if (typeof result !== 'object') return false;

    const record = result as Record<string, unknown>;
    if (record.success === false) return true;

    if (message.type === 'SYNC_GET_POSITION') {
      return !(
        this.isFiniteNumber(record.currentTime) &&
        typeof record.paused === 'boolean' &&
        this.isFiniteNumber(record.playbackRate) &&
        this.isFiniteNumber(record.timestamp)
      );
    }

    return false;
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private recordSendFailure(
    tabId: number,
    frameId: number | undefined,
    message: HareMessage,
    reason: unknown
  ): void {
    if (!this.isSyncedEndpoint(tabId)) return;

    const key = this.endpointKey(tabId, frameId);
    const failures = (this.sendFailures.get(key) ?? 0) + 1;
    this.sendFailures.set(key, failures);
    logger.warn(`Send to tab ${tabId} failed (${failures}/${SyncCoordinator.MAX_SEND_FAILURES}):`, reason);
    if (failures >= SyncCoordinator.MAX_SEND_FAILURES) {
      this.stopSync(`sendToTab failed ${failures} times for tab ${tabId}, msg: ${message.type}, last error: ${this.formatFailureReason(reason)}`);
    }
  }

  private formatFailureReason(reason: unknown): string {
    if (reason instanceof Error) return reason.message;
    if (typeof reason === 'string') return reason;
    try {
      return JSON.stringify(reason);
    } catch {
      return String(reason);
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
