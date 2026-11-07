import { createIcon, type ICONS } from './controller-icons';
import type { KeyAction } from './key-actions';

const BUTTONS: ReadonlyArray<[icon: keyof typeof ICONS, action: KeyAction, label: string]> = [
  ['rewind', 'rewind', 'Rewind'],
  ['slower', 'slower', 'Slower'],
  ['faster', 'faster', 'Faster'],
  ['advance', 'advance', 'Advance'],
  ['hide', 'display', 'Hide controller'],
];

export function createControllerView() {
  const controllerEl = document.createElement('div');
  controllerEl.className = 'hare-controller';
  const speedDisplay = document.createElement('span');
  speedDisplay.className = 'hare-speed';
  speedDisplay.textContent = '1.00x';
  speedDisplay.setAttribute('role', 'status');
  speedDisplay.setAttribute('aria-live', 'polite');
  speedDisplay.setAttribute('aria-label', 'Current playback speed');
  speedDisplay.tabIndex = 0;
  const controls = document.createElement('span');
  controls.className = 'hare-controls';
  const buttons = new Map<KeyAction, HTMLButtonElement>();
  for (const [icon, action, label] of BUTTONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hare-btn';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.append(createIcon(icon));
    buttons.set(action, button);
    controls.append(button);
  }
  controllerEl.append(speedDisplay, controls);
  return { controllerEl, speedDisplay, buttons };
}
