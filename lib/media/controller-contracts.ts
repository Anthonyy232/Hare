import type { KeyAction } from '../settings/key-actions';

export interface ActionTarget {
  /** Runs a shortcut's action with the shortcut's value. */
  perform(action: KeyAction, value: number): void;
}

export interface HitmapButton {
  controllerId: string;
  action: KeyAction;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PointerTarget extends ActionTarget {
  readonly id: string;
  /** Presses one of the controller's own buttons. */
  press(action: KeyAction): void;
  getButtonHitmap(): HitmapButton[];
}
