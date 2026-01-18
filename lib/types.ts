export type KeyAction =
  | 'slower'
  | 'faster'
  | 'rewind'
  | 'advance'
  | 'reset'
  | 'display';

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

export interface ControllerPosition {
  target: Element;
  method: 'prepend' | 'append' | 'before' | 'after';
}

/**
 * Interface for site-specific logic to handle custom player structures.
 */
export interface SiteHandler {
  matches(): boolean;

  /** Resolves the ideal DOM mount point to avoid obstructing native controls. */
  getControllerPosition(
    video: HTMLVideoElement
  ): ControllerPosition | null;

  /** Identifies videos that should be ignored, such as tiny previews or hidden ads. */
  shouldIgnoreVideo(video: HTMLVideoElement): boolean;
}

export type MessageType =
  | 'GET_STATUS'
  | 'SET_SPEED'
  | 'ADJUST_SPEED'
  | 'RESET_SPEED'
  | 'TOGGLE_DISPLAY';

export interface HareMessage {
  type: MessageType;
  payload?: unknown;
}

export interface StatusResponse {
  hasVideos: boolean;
  currentSpeed: number;
  videoCount: number;
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
