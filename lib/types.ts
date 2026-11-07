import { defaultKeyBindings, type KeyBinding } from './key-actions';

export interface Settings {
  enabled: boolean;
  enableAudio: boolean;
  startHidden: boolean;
  controllerOpacity: number;
  controllerButtonSize: number;
  keyBindings: KeyBinding[];
  blacklist: string;
}

export interface SiteHandler {
  findContainer(video: HTMLVideoElement): Element | null;
  shouldIgnoreVideo(video: HTMLVideoElement): boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  enableAudio: false,
  startHidden: false,
  controllerOpacity: 0.3,
  controllerButtonSize: 14,
  keyBindings: defaultKeyBindings(),
  blacklist: [
    'instagram.com',
    'x.com',
    'twitter.com',
    'imgur.com',
    'teams.microsoft.com',
    'meet.google.com',
  ].join('\n'),
};
