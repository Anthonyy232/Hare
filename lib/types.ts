import type { DriftCorrectPayload, SyncCandidate, SyncCommandPayload, SyncEventPayload, SyncPositionResponse, SyncStatusResponse } from './sync-types';

export const KEY_ACTIONS = ['slower', 'faster', 'rewind', 'advance', 'reset', 'display'] as const;
export type KeyAction = typeof KEY_ACTIONS[number];

export function isKeyAction(value: unknown): value is KeyAction {
  return KEY_ACTIONS.includes(value as KeyAction);
}

export interface KeyBinding {
  action: KeyAction;
  key: string; // e.g., 'KeyS'
  value: number; // speed step or seek offset
  force: boolean; // intercept event even if site has its own listener
}

export interface Settings {
  enabled: boolean;
  enableAudio: boolean;
  startHidden: boolean;
  controllerOpacity: number;
  controllerButtonSize: number;
  keyBindings: KeyBinding[];
  blacklist: string; // newline-delimited hostnames or regexes
}

export interface SiteHandler {
  /** Resolves the ideal mount point to avoid obstructing native controls. */
  findContainer(video: HTMLVideoElement): Element | null;
  shouldIgnoreVideo(video: HTMLVideoElement): boolean;
}

export type HareMessage =
  | { type: 'GET_PAGE_CONTEXT' }
  | { type: 'GET_STATUS' }
  | { type: 'SET_SPEED'; payload: number }
  | { type: 'RESET_SPEED' }
  | { type: 'TOGGLE_DISPLAY' }
  // Sync coordination (background <-> content)
  | { type: 'SYNC_ACTIVATE' }
  | { type: 'SYNC_DEACTIVATE' }
  | { type: 'SYNC_EVENT'; payload: SyncEventPayload }
  | { type: 'SYNC_PAUSE' | 'SYNC_PLAY' | 'SYNC_SEEK' | 'SYNC_RATE'; payload: SyncCommandPayload }
  | { type: 'SYNC_DRIFT_CORRECT'; payload: DriftCorrectPayload }
  | { type: 'SYNC_GET_POSITION' }
  // Sync management (popup <-> background)
  | { type: 'GET_SYNC_CANDIDATES' }
  | { type: 'START_SYNC'; payload: { tabIdA: number; tabIdB: number } }
  | { type: 'STOP_SYNC' }
  | { type: 'NUDGE_OFFSET'; payload: number }
  | { type: 'SET_NUDGE_STEP'; payload: number }
  | { type: 'GET_SYNC_STATUS' };

export type Ack = { success: boolean; error?: string };

/** Reply for each message type. Any handler may also reply `{ success: false, error }` if it throws. */
export interface Replies {
  GET_PAGE_CONTEXT: { hostname: string };
  GET_STATUS: { speeds: number[] };
  SET_SPEED: Ack;
  RESET_SPEED: Ack;
  TOGGLE_DISPLAY: Ack;
  SYNC_ACTIVATE: (SyncPositionResponse & { success: true }) | { success: false; error: string };
  SYNC_DEACTIVATE: Ack;
  SYNC_EVENT: Ack;
  SYNC_PAUSE: Ack;
  SYNC_PLAY: Ack;
  SYNC_SEEK: Ack;
  SYNC_RATE: Ack;
  SYNC_DRIFT_CORRECT: Ack;
  SYNC_GET_POSITION: SyncPositionResponse | null;
  GET_SYNC_CANDIDATES: SyncCandidate[];
  START_SYNC: Ack;
  STOP_SYNC: Ack;
  NUDGE_OFFSET: Ack;
  SET_NUDGE_STEP: Ack;
  GET_SYNC_STATUS: SyncStatusResponse;
}

export type Reply<M extends HareMessage> = Replies[M['type']];

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  enableAudio: false,
  startHidden: false,
  controllerOpacity: 0.3,
  controllerButtonSize: 14,
  keyBindings: [
    { action: 'slower', key: 'KeyS', value: 0.1, force: false },
    { action: 'faster', key: 'KeyD', value: 0.1, force: false },
    { action: 'rewind', key: 'KeyZ', value: 10, force: false },
    { action: 'advance', key: 'KeyX', value: 10, force: false },
    { action: 'reset', key: 'KeyR', value: 1.0, force: false },
    { action: 'display', key: 'KeyV', value: 0, force: false },
  ],
  blacklist: [
    'instagram.com',
    'x.com',
    'twitter.com',
    'imgur.com',
    'teams.microsoft.com',
    'meet.google.com',
  ].join('\n'),
};
