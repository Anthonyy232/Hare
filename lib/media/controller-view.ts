import type { KeyAction } from '../settings/key-actions';

export const CONTROLLER_TAG = 'hare-controller';

const BUTTONS: ReadonlyArray<[action: KeyAction, label: string, icon: string]> = [
  ['rewind', 'Rewind', `<svg viewBox="0 0 24 24"><polyline points="11 17 6 12 11 7"></polyline><polyline points="18 17 13 12 18 7"></polyline></svg>`],
  ['slower', 'Slower', `<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`],
  ['faster', 'Faster', `<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`],
  ['advance', 'Advance', `<svg viewBox="0 0 24 24"><polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline></svg>`],
  ['display', 'Hide controller', `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`],
];

const parsedIcons = new Map<string, SVGElement>();

function createIcon(markup: string): SVGElement {
  let svg = parsedIcons.get(markup);
  if (!svg) {
    svg = new DOMParser().parseFromString(markup, 'text/html').querySelector('svg')!;
    parsedIcons.set(markup, svg);
  }
  return document.importNode(svg, true);
}

export function createControllerView() {
  const controllerEl = document.createElement('div');
  controllerEl.className = 'hare-controller';
  const speedDisplay = document.createElement('span');
  speedDisplay.className = 'hare-speed';
  speedDisplay.setAttribute('role', 'status');
  speedDisplay.setAttribute('aria-live', 'polite');
  speedDisplay.setAttribute('aria-label', 'Current playback speed');
  speedDisplay.tabIndex = 0;
  const controls = document.createElement('span');
  controls.className = 'hare-controls';
  const buttons = new Map<KeyAction, HTMLButtonElement>();
  for (const [action, label, icon] of BUTTONS) {
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

export function applyAppearance(controllerEl: HTMLElement, opacity: number, buttonSize: number): void {
  controllerEl.style.setProperty('--hare-opacity', String(opacity));
  controllerEl.style.setProperty('--hare-font-size', `${buttonSize}px`);
}
