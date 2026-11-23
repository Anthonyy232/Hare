import { logger } from '../logger';

/**
 * A short speed-up or slow-down that drift correction layers over a player's chosen rate.
 * Seeks end it early (restore); a newly chosen rate replaces it (setBase).
 */
/** `R` is what applying a rate returns: nothing for a page player, a request for mpv. */
export class RateCorrection<R extends void | Promise<unknown>> {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private baseRate: number,
    private readonly applyRate: (rate: number) => R,
  ) {}

  /** The rate the player runs at without a correction. */
  get base(): number {
    return this.baseRate;
  }

  apply(rateFactor: number, durationMs: number): R {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      (async () => this.applyRate(this.baseRate))().catch(error =>
        logger.debug('Could not restore the rate after a drift correction:', error),
      );
    }, durationMs);
    return this.applyRate(this.baseRate + rateFactor);
  }

  /** Ends a running correction at the chosen rate. */
  restore(): R | undefined {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    return this.applyRate(this.baseRate);
  }

  /** The player itself now runs at `rate`, so a running correction has nothing left to restore. */
  setBase(rate: number): void {
    this.cancel();
    this.baseRate = rate;
  }

  /** Drops a running correction without touching the player. */
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
