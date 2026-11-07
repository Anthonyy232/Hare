import { SPEED } from '../speed';

interface ActionDefinition {
  label: string;
  defaultKey: string;
  defaultValue: number;
  repeat: boolean;
  value: { label: string; unit: string; min: number; max: number } | null;
}

export const ACTIONS = {
  slower: { label: 'Decrease Speed', defaultKey: 'KeyS', defaultValue: SPEED.STEP, repeat: true, value: { label: 'Speed step', unit: '×', min: 0.01, max: SPEED.MAX } },
  faster: { label: 'Increase Speed', defaultKey: 'KeyD', defaultValue: SPEED.STEP, repeat: true, value: { label: 'Speed step', unit: '×', min: 0.01, max: SPEED.MAX } },
  rewind: { label: 'Rewind', defaultKey: 'KeyZ', defaultValue: 10, repeat: true, value: { label: 'Seconds', unit: 'sec', min: 0.01, max: 86400 } },
  advance: { label: 'Advance', defaultKey: 'KeyX', defaultValue: 10, repeat: true, value: { label: 'Seconds', unit: 'sec', min: 0.01, max: 86400 } },
  reset: { label: 'Reset Speed', defaultKey: 'KeyR', defaultValue: SPEED.DEFAULT, repeat: false, value: { label: 'Target speed', unit: '×', min: SPEED.MIN, max: SPEED.MAX } },
  display: { label: 'Show/Hide Controller', defaultKey: 'KeyV', defaultValue: 0, repeat: false, value: null },
} satisfies Record<string, ActionDefinition>;

export type KeyAction = keyof typeof ACTIONS;
const KEY_ACTIONS = Object.keys(ACTIONS) as KeyAction[];

export interface KeyBinding {
  action: KeyAction;
  key: string;
  value: number;
  force: boolean;
}

/** Shortcuts are single keys: no modifiers, and not a key an input method is still composing. */
export function isShortcutKey(event: KeyboardEvent): boolean {
  return !event.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
}

export function isKeyAction(value: unknown): value is KeyAction {
  return typeof value === 'string' && Object.hasOwn(ACTIONS, value);
}

export function clampBindingValue(action: KeyAction, value: number): number {
  const bounds = ACTIONS[action].value;
  return bounds ? Math.max(bounds.min, Math.min(bounds.max, value)) : value;
}

export function defaultKeyBindings(): KeyBinding[] {
  return KEY_ACTIONS.map(action => ({ action, key: ACTIONS[action].defaultKey, value: ACTIONS[action].defaultValue, force: false }));
}
