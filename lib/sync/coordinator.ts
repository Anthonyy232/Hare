import { browser } from 'wxt/browser';
import { logger } from '../logger';
import type { HareMessage, Reply } from '../messages';
import type { SyncTransport } from './transport';
import {
  IN_SYNC_SECONDS,
  MPV_TAB_ID,
  NUDGE_STEPS,
  positionAt,
  type SyncedEndpoint,
  type SyncEventPayload,
  type SyncPositionResponse,
  type SyncSession,
  type SyncStatusResponse,
} from './types';

// Session storage survives worker restarts but is cleared on browser exit and extension reload/update,
// so it only ever holds this build's session shape.
const STORAGE_KEY = 'syncSession';
const DEFAULT_NUDGE_STEP = 0.1;
const DRIFT_CHECK_INTERVAL_MS = 2000;
/** Drift below this is caught up by playing slightly faster; above it, by seeking. */
const RATE_ADJUST_THRESHOLD_SECONDS = 0.15;
const RATE_ADJUST_FACTOR = 0.02;
const RATE_ADJUST_DURATION_MS = 3000;
/** How long a recovered player must stay ready before both resume. */
const BUFFERING_STABLE_MS = 50;
const MAX_SEND_FAILURES = 5;

type Side = 'A' | 'B';
const opposite = (side: Side): Side => side === 'A' ? 'B' : 'A';

function isEndpointId(id: number): boolean {
  return id === MPV_TAB_ID || (Number.isInteger(id) && id >= 0);
}

function extrapolate(position: SyncPositionResponse, now: number): number {
  return position.paused || position.buffering
    ? position.currentTime
    : positionAt(position.currentTime, position.playbackRate, position.timestamp, now);
}

function isValidReply(message: HareMessage, result: unknown): boolean {
  if (result == null || typeof result !== 'object') return false;
  const reply = result as Record<string, unknown>;
  if (message.type !== 'SYNC_GET_POSITION') return reply.success === true;
  const isFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  return isFinite(reply.currentTime) && reply.currentTime >= 0
    && typeof reply.paused === 'boolean' && typeof reply.buffering === 'boolean'
    && isFinite(reply.playbackRate) && reply.playbackRate > 0
    && isFinite(reply.timestamp) && reply.timestamp >= 0;
}

/** Owns the sync session: starting and stopping it, relaying player events, and correcting drift. */
export class SyncCoordinator {
  readonly ready: Promise<void>;
  private session: SyncSession | null = null;
  /** Bumped whenever a session ends, so a startup that began before can tell it was cancelled. */
  private revision = 0;
  private starting: Promise<void> | null = null;
  private teardownDone: Promise<void> = Promise.resolve();
  private driftCheckRunning = false;
  private driftInterval: ReturnType<typeof setInterval> | null = null;
  private bufferStableTimers = new Map<Side, ReturnType<typeof setTimeout>>();
  private sendFailures = new Map<Side, number>();
  private storageWrites: Promise<void> = Promise.resolve();

  constructor(private readonly transport: SyncTransport) {
    this.ready = this.restore();
  }

  async start(tabIdA: number, tabIdB: number): Promise<void> {
    if (this.starting) throw new Error('Sync is already starting. Please wait.');
    if (![tabIdA, tabIdB].every(isEndpointId) || tabIdA === tabIdB) {
      throw new Error('Select two different tabs.');
    }
    this.starting = this.activatePair(tabIdA, tabIdB);
    try { await this.starting; }
    finally { this.starting = null; }
  }

  /** Ends the session, and cancels a startup in progress. */
  async stop(reason: string): Promise<void> {
    const starting = this.starting;
    await this.teardown(reason);
    await starting?.catch(() => {});
  }

  nudgeOffset(delta: number): void {
    if (!this.session) throw new Error('The sync session has ended.');
    if (!Number.isFinite(delta)) throw new Error('Choose a valid offset.');
    this.session.offset += delta;
    this.bump();
    logger.debug('Offset nudged', { newOffset: this.session.offset });
    void this.realignB();
  }

  async setNudgeStep(step: number): Promise<void> {
    if (!this.session) throw new Error('The sync session has ended.');
    if (!NUDGE_STEPS.includes(step)) throw new Error('Choose a valid nudge step.');
    this.session.nudgeStep = step;
    await this.persistSession();
  }

  getStatus(): SyncStatusResponse {
    if (!this.session) return { active: false };
    const { videoA, videoB, offset, nudgeStep } = this.session;
    return {
      active: true,
      videoA: { title: videoA.title },
      videoB: { title: videoB.title },
      offset,
      nudgeStep,
    };
  }

  hasEndpoint(tabId: number, frameId?: number): boolean {
    return this.sideOf(tabId, frameId) !== null;
  }

  handleTabRemoved(tabId: number): void {
    if (this.session && (this.session.videoA.tabId === tabId || this.session.videoB.tabId === tabId)) {
      void this.stop(`tab ${tabId} was closed`);
    }
  }

  async handleSyncEvent(fromTabId: number, event: SyncEventPayload, fromFrameId?: number): Promise<void> {
    await this.ready;
    const session = this.session;
    if (!session || !event || ![event.position, event.timestamp, event.rate].every(Number.isFinite) || event.rate <= 0) return;
    const side = this.sideOf(fromTabId, fromFrameId);
    if (!side) return;
    const target = opposite(side);
    const position = Math.max(0, this.positionFor(target, event.position));

    switch (event.action) {
      case 'pause':
        session.bufferingSide = null;
        this.clearBufferTimers();
        this.bump();
        await this.sendTo(target, { type: 'SYNC_PAUSE', payload: { position } });
        break;
      case 'play':
        this.bump();
        await this.sendTo(target, { type: 'SYNC_PLAY', payload: { from: { position, rate: event.rate, timestamp: event.timestamp } } });
        break;
      case 'seek':
        this.bump();
        await this.sendTo(target, { type: 'SYNC_SEEK', payload: { position } });
        break;
      case 'ratechange':
        this.bump();
        await this.sendTo(target, { type: 'SYNC_RATE', payload: { rate: event.rate } });
        break;
      case 'buffering_start':
        await this.handleBufferingStart(side, event.position);
        break;
      case 'buffering_end':
        this.handleBufferingEnd(side);
        break;
    }
  }

  private async restore(): Promise<void> {
    const revision = this.revision;
    try {
      const stored = await browser.storage.session.get(STORAGE_KEY);
      const session = stored[STORAGE_KEY] as SyncSession | undefined;
      if (!session || revision !== this.revision) return;
      this.session = session;
      this.startDriftCorrection();
      logger.debug('Sync session restored after the worker restarted', { offset: session.offset });
    } catch (error) {
      logger.error('Failed to restore sync session:', error);
    }
  }

  private async activatePair(tabIdA: number, tabIdB: number): Promise<void> {
    const requested = this.revision;
    await this.ready;
    if (requested !== this.revision) throw new Error('Sync startup cancelled.');
    const stopped = this.teardown('replacing session');
    const revision = this.revision;
    const ensureCurrent = () => {
      if (revision !== this.revision) throw new Error('Sync startup cancelled.');
    };
    const attempted: Array<{ tabId: number; frameId: number }> = [];
    try {
      await stopped;
      ensureCurrent();
      const activate = async (tabId: number) => {
        for (const frameId of await this.transport.frames(tabId)) {
          ensureCurrent();
          attempted.push({ tabId, frameId });
          try {
            const result = await this.transport.send(tabId, { type: 'SYNC_ACTIVATE' }, frameId);
            if (result.success) return { ...result, frameId };
          } catch { /* Try the next frame. Every attempted frame is deactivated if startup fails. */ }
        }
        throw new Error('A selected tab has no available media. Reload it and refresh the tab list.');
      };
      const attempts = [activate(tabIdA), activate(tabIdB)] as const;
      // Let both finish before failing, so every frame either one activated is in `attempted` for cleanup.
      await Promise.allSettled(attempts);
      const [a, b] = await Promise.all(attempts);
      ensureCurrent();
      if (!Number.isFinite(a.currentTime) || !Number.isFinite(b.currentTime)) {
        throw new Error('A selected player has no valid position. Reload it and try again.');
      }

      const rateReply = await this.transport.send(tabIdB, { type: 'SYNC_RATE', payload: { rate: a.playbackRate } }, b.frameId);
      if (!rateReply.success) throw new Error('The second player could not match the playback speed.');
      if (a.paused !== b.paused) {
        const stateReply = await this.transport.send(tabIdB, a.paused
          ? { type: 'SYNC_PAUSE', payload: {} }
          : { type: 'SYNC_PLAY', payload: {} }, b.frameId);
        if (!stateReply.success) throw new Error('Press play in both tabs, then try starting sync again.');
      }
      ensureCurrent();
      const [titleA, titleB] = await Promise.all([this.transport.title(tabIdA), this.transport.title(tabIdB)]);
      ensureCurrent();
      this.begin({ tabId: tabIdA, frameId: a.frameId, title: titleA }, a, { tabId: tabIdB, frameId: b.frameId, title: titleB }, b);
    } catch (error) {
      await Promise.allSettled(attempted.map(({ tabId, frameId }) => this.transport.send(tabId, { type: 'SYNC_DEACTIVATE' }, frameId)));
      throw error;
    }
  }

  private begin(videoA: SyncedEndpoint, a: SyncPositionResponse, videoB: SyncedEndpoint, b: SyncPositionResponse): void {
    // The two positions were read at different moments; compare them at the later one.
    const refTime = Math.max(a.timestamp, b.timestamp);
    const positionA = extrapolate(a, refTime);
    const positionB = extrapolate(b, refTime);
    this.session = {
      videoA,
      videoB,
      offset: positionB - positionA,
      nudgeStep: DEFAULT_NUDGE_STEP,
      generation: 0,
      bufferingSide: null,
    };
    this.sendFailures.clear();
    this.startDriftCorrection();
    void this.persistSession();
    if (a.buffering) void this.handleBufferingStart('A', positionA);
    if (b.buffering) void this.handleBufferingStart('B', positionB);
    logger.debug('Sync session started', { tabA: videoA.tabId, tabB: videoB.tabId, offset: this.session.offset });
  }

  private teardown(reason: string): Promise<void> {
    this.revision++;
    if (this.driftInterval) {
      clearInterval(this.driftInterval);
      this.driftInterval = null;
    }
    this.clearBufferTimers();
    const session = this.session;
    this.session = null;
    this.sendFailures.clear();

    const pending: Promise<unknown>[] = [this.teardownDone, this.clearPersistedSession()];
    if (session) {
      for (const { tabId, frameId } of [session.videoA, session.videoB]) {
        pending.push(this.transport.send(tabId, { type: 'SYNC_DEACTIVATE' }, frameId));
      }
      logger.debug(`Sync session stopped. Reason: ${reason}`);
    }
    this.teardownDone = Promise.allSettled(pending).then(() => {});
    return this.teardownDone;
  }

  private bump(): void {
    this.session!.generation++;
    void this.persistSession();
  }

  private async realignB(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const generation = session.generation;
    const positionA = await this.requestPosition('A');
    if (!positionA || this.session !== session || session.generation !== generation) return;
    await this.sendTo('B', {
      type: 'SYNC_DRIFT_CORRECT',
      payload: { method: 'seek', position: Math.max(0, extrapolate(positionA, Date.now()) + session.offset) },
    });
  }

  /** Where `side` should be while the other side is at `position`. */
  private positionFor(side: Side, position: number): number {
    const { offset } = this.session!;
    return position + (side === 'B' ? offset : -offset);
  }

  private sideOf(tabId: number, frameId?: number): Side | null {
    if (!this.session) return null;
    const matches = (endpoint: SyncedEndpoint) => endpoint.tabId === tabId
      && (frameId == null || endpoint.frameId === frameId);
    if (matches(this.session.videoA)) return 'A';
    if (matches(this.session.videoB)) return 'B';
    return null;
  }

  private isBuffering(side: Side): boolean {
    return this.session?.bufferingSide === side || this.session?.bufferingSide === 'both';
  }

  private clearBufferTimers(): void {
    for (const timer of this.bufferStableTimers.values()) clearTimeout(timer);
    this.bufferStableTimers.clear();
  }

  private async handleBufferingStart(side: Side, position: number): Promise<void> {
    const session = this.session;
    if (!session) return;
    clearTimeout(this.bufferStableTimers.get(side));
    this.bufferStableTimers.delete(side);
    if (this.isBuffering(side)) return;

    const target = opposite(side);
    const targetPosition = this.positionFor(target, position);
    session.bufferingSide = session.bufferingSide === null ? side : 'both';
    this.bump();
    await this.sendTo(target, {
      type: 'SYNC_PAUSE',
      // Near the start, the offset can't be kept; pause the other side where it is.
      payload: { buffering: true, position: targetPosition < 0 ? undefined : targetPosition },
    });
  }

  private handleBufferingEnd(side: Side): void {
    if (!this.isBuffering(side) || this.bufferStableTimers.has(side)) return;
    const session = this.session!;
    this.bufferStableTimers.set(side, setTimeout(() => {
      this.bufferStableTimers.delete(side);
      if (this.session !== session || !this.isBuffering(side)) return;
      session.bufferingSide = session.bufferingSide === 'both' ? opposite(side) : null;
      this.bump();
      if (session.bufferingSide !== null) return;
      void this.sendTo('A', { type: 'SYNC_PLAY', payload: {} });
      void this.sendTo('B', { type: 'SYNC_PLAY', payload: {} });
    }, BUFFERING_STABLE_MS));
  }

  private startDriftCorrection(): void {
    this.driftInterval = setInterval(() => void this.checkDrift(), DRIFT_CHECK_INTERVAL_MS);
  }

  private async checkDrift(): Promise<void> {
    const session = this.session;
    if (!session || this.driftCheckRunning) return;
    this.driftCheckRunning = true;
    const generation = session.generation;

    try {
      const [positionA, positionB] = await Promise.all([this.requestPosition('A'), this.requestPosition('B')]);
      if (!positionA || !positionB) return;
      if (this.session !== session || session.generation !== generation) return;
      // Keep checking during buffering: recovery events can be lost during worker restart.
      for (const [side, position] of [['A', positionA], ['B', positionB]] as const) {
        if (position.buffering) void this.handleBufferingStart(side, position.currentTime);
        else this.handleBufferingEnd(side);
      }
      if (session.bufferingSide !== null || positionA.buffering || positionB.buffering) return;
      // Pause/play events reconcile paused players; drift correction cannot.
      if (positionA.paused || positionB.paused) return;

      const now = Date.now();
      const correctedA = extrapolate(positionA, now);
      const correctedB = extrapolate(positionB, now);
      const expectedB = correctedA + session.offset;
      const expectedA = correctedB - session.offset;
      // One video is near its start, so the offset can't be kept here. Don't fight the user.
      if (expectedB < 0 || expectedA < 0) return;

      const drift = correctedB - expectedB;
      if (Math.abs(drift) < IN_SYNC_SECONDS) return;
      const behind: Side = drift < 0 ? 'B' : 'A';
      const byRate = Math.abs(drift) < RATE_ADJUST_THRESHOLD_SECONDS;
      await this.sendTo(behind, {
        type: 'SYNC_DRIFT_CORRECT',
        payload: byRate
          ? { method: 'rate', rateFactor: RATE_ADJUST_FACTOR, durationMs: RATE_ADJUST_DURATION_MS }
          : { method: 'seek', position: behind === 'B' ? expectedB : expectedA },
      });
      logger.debug('Drift correction applied', { driftMs: Math.round(drift * 1000), method: byRate ? 'rate' : 'seek', side: behind });
    } catch (error) {
      logger.error('Drift check failed:', error);
    } finally {
      this.driftCheckRunning = false;
    }
  }

  private requestPosition(side: Side): Promise<SyncPositionResponse | null> {
    return this.sendTo(side, { type: 'SYNC_GET_POSITION' });
  }

  /** Sends to a side of the current session. Replies that arrive after the session changed are dropped. */
  private async sendTo<M extends HareMessage>(side: Side, message: M): Promise<Reply<M> | null> {
    const session = this.session;
    if (!session) return null;
    const { tabId, frameId } = side === 'A' ? session.videoA : session.videoB;
    try {
      const result = await this.transport.send(tabId, message, frameId);
      if (session !== this.session) return null;
      if (!isValidReply(message, result)) {
        this.recordSendFailure(side, result);
        return null;
      }
      this.sendFailures.delete(side);
      return result;
    } catch (error) {
      if (session === this.session) this.recordSendFailure(side, error);
      return null;
    }
  }

  private recordSendFailure(side: Side, reason: unknown): void {
    const failures = (this.sendFailures.get(side) ?? 0) + 1;
    this.sendFailures.set(side, failures);
    logger.warn(`Send to side ${side} failed (${failures}/${MAX_SEND_FAILURES}):`, reason);
    if (failures >= MAX_SEND_FAILURES) void this.stop(`side ${side} stopped responding`);
  }

  private persistSession(): Promise<void> {
    const session = this.session;
    if (!session) return Promise.resolve();
    const snapshot = structuredClone(session);
    this.storageWrites = this.storageWrites
      .then(() => browser.storage.session.set({ [STORAGE_KEY]: snapshot }))
      .catch(error => logger.error('Failed to persist sync session:', error));
    return this.storageWrites;
  }

  private clearPersistedSession(): Promise<void> {
    this.storageWrites = this.storageWrites
      .then(() => browser.storage.session.remove(STORAGE_KEY))
      .catch(error => logger.error('Failed to clear persisted sync session:', error));
    return this.storageWrites;
  }
}
