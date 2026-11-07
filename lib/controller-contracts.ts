import type { KeyAction } from './key-actions';

export interface ActionTarget {
  perform(action: KeyAction, value: number): void;
}

export interface HitmapButton {
  controllerId: string;
  action: KeyAction;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PointerTarget extends ActionTarget {
  readonly id: string;
  getButtonHitmap(): HitmapButton[];
}
