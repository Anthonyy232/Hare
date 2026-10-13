import type { DriftCorrectPayload, SyncCommandPayload, SyncEventPayload } from './sync-types';

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

export interface StatusResponse {
  hasVideos: boolean;
  currentSpeed: number;
  videoCount: number;
  mixedSpeeds?: boolean;
  enabled?: boolean;
  excluded?: boolean;
}

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
