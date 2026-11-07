export const SPEED = {
  MIN: 0.07,
  MAX: 16,
  DEFAULT: 1,
  STEP: 0.1,
} as const;

/** Limits a rate to what browsers accept. */
export function clampRate(rate: number): number {
  return Math.max(SPEED.MIN, Math.min(SPEED.MAX, rate));
}

/** A speed the user chooses: a rate rounded to the 0.01 Hare displays. Drift corrections use finer rates. */
export function clampSpeed(speed: number): number {
  return Math.round(clampRate(speed) * 100) / 100;
}

/** Speeds that display the same are the same, whatever float noise a player adds. */
export function sameSpeed(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}
