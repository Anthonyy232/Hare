import type { HareMessage, Reply } from '../messages';
import { IN_SYNC_SECONDS, positionAt } from './types';

const SYNC_COMMANDS = ['SYNC_PAUSE', 'SYNC_PLAY', 'SYNC_SEEK', 'SYNC_RATE', 'SYNC_DRIFT_CORRECT'] as const;
export type SyncCommand = Extract<HareMessage, { type: typeof SYNC_COMMANDS[number] }>;

/** Move to `position`, unless the player is already within `tolerance` seconds of it. */
export interface SeekTarget {
  position: number;
  tolerance: number;
}

/**
 * A player that sync can drive: a tab's media or mpv.
 * Seeks and new rates end a running rate correction.
 */
export interface SyncPlayer {
  pause(seek: SeekTarget | undefined, buffering: boolean): void | Promise<void>;
  /** Resolves false when the player refused to play or a later command superseded this one. */
  play(seek: SeekTarget | undefined): Promise<boolean>;
  seek(target: SeekTarget): void | Promise<void>;
  /** Resolves whether the player now runs at `rate`. */
  setRate(rate: number): boolean | Promise<boolean>;
  correctRate(rateFactor: number, durationMs: number): void | Promise<void>;
}

const align = (position: number): SeekTarget => ({ position, tolerance: IN_SYNC_SECONDS });

export function isSyncCommand(message: HareMessage): message is SyncCommand {
  return (SYNC_COMMANDS as readonly string[]).includes(message.type);
}

export async function runSyncCommand(player: SyncPlayer, message: SyncCommand): Promise<Reply<SyncCommand>> {
  switch (message.type) {
    case 'SYNC_PAUSE': {
      const { position, buffering } = message.payload;
      await player.pause(position === undefined ? undefined : align(position), buffering === true);
      return { success: true };
    }
    case 'SYNC_PLAY': {
      const { from } = message.payload;
      return { success: await player.play(from && align(positionAt(from.position, from.rate, from.timestamp))) };
    }
    case 'SYNC_SEEK':
      await player.seek(align(message.payload.position));
      return { success: true };
    case 'SYNC_RATE':
      return { success: await player.setRate(message.payload.rate) };
    case 'SYNC_DRIFT_CORRECT': {
      const drift = message.payload;
      if (drift.method === 'seek') await player.seek({ position: drift.position, tolerance: 0 });
      else await player.correctRate(drift.rateFactor, drift.durationMs);
      return { success: true };
    }
  }
}
