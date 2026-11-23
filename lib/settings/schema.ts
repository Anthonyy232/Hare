import { defaultKeyBindings, type KeyBinding } from './key-actions';

// No extension APIs here: the e2e tests import these defaults in Node.

export interface Settings {
  enabled: boolean;
  enableAudio: boolean;
  startHidden: boolean;
  controllerOpacity: number;
  controllerButtonSize: number;
  keyBindings: KeyBinding[];
  blacklist: string;
}

export const OPACITY_RANGE = { MIN: 0.1, MAX: 1 } as const;
export const BUTTON_SIZE_RANGE = { MIN: 10, MAX: 24 } as const;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  enableAudio: false,
  startHidden: false,
  controllerOpacity: 0.3,
  controllerButtonSize: 14,
  keyBindings: defaultKeyBindings(),
  blacklist: ['instagram.com', 'x.com', 'twitter.com', 'imgur.com', 'teams.microsoft.com', 'meet.google.com'].join(
    '\n',
  ),
};
