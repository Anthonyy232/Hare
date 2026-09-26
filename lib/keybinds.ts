import type { Settings, KeyAction, KeyBinding } from './types';
import type { VideoController } from './controller';

function isInputElement(element: Element): boolean {
  return element.matches('input, textarea, select')
    || (element as HTMLElement).isContentEditable
    || !!element.closest('[contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]');
}

export function executeAction(
  action: KeyAction,
  binding: KeyBinding,
  controllers: VideoController[]
): void {
  for (const controller of controllers) {
    switch (action) {
      case 'slower':
        controller.adjustSpeed(-binding.value);
        controller.showOSD(`${controller.speed.toFixed(2)}x`);
        break;
      case 'faster':
        controller.adjustSpeed(binding.value);
        controller.showOSD(`${controller.speed.toFixed(2)}x`);
        break;
      case 'rewind':
        controller.seek(-binding.value);
        break;
      case 'advance':
        controller.seek(binding.value);
        break;
      case 'reset':
        controller.setSpeed(binding.value);
        controller.showOSD(`${controller.speed.toFixed(2)}x`);
        break;
      case 'display':
        controller.toggleVisibility();
        break;
    }
  }
}

export type KeybindHandler = {
  handleKeyDown: (event: KeyboardEvent) => void;
  destroy: () => void;
};

// Forward shortcuts when focus remains in a host frame above a cross-origin player.
type HareKeyForwardMessage = {
  __hareKeyForward: true;
  action: KeyAction;
  value: number;
};

function isHareKeyForwardMessage(data: unknown): data is HareKeyForwardMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    d.__hareKeyForward === true &&
    typeof d.action === 'string' &&
    ['slower', 'faster', 'rewind', 'advance', 'reset', 'display'].includes(d.action) &&
    typeof d.value === 'number' && Number.isFinite(d.value) && d.value >= 0
  );
}

function forwardToChildFrames(action: KeyAction, value: number): void {
  const msg: HareKeyForwardMessage = { __hareKeyForward: true, action, value };
  for (let i = 0; i < window.frames.length; i++) {
    try {
      window.frames[i].postMessage(msg, '*');
    } catch {
      /* postMessage is allowed cross-origin; swallow exotic failures */
    }
  }
}

export function createKeybindHandler(
  getControllers: () => VideoController[],
  getSettings: () => Settings
): KeybindHandler {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.keyCode === 229 || document.designMode === 'on') return;
    const path = event.composedPath();
    if (path.some(target => target instanceof Element && isInputElement(target))) return;
    if (event.target instanceof Element && isInputElement(event.target)) return;

    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;

    const settings = getSettings();
    if (!settings.enabled) return;

    const binding = settings.keyBindings.find(binding => binding.key && binding.key === event.code);
    if (!binding) return;
    if (event.repeat && (binding.action === 'display' || binding.action === 'reset')) return;

    const controllers = getControllers();
    if (controllers.length > 0) {
      executeAction(binding.action, binding, controllers);
    } else if (window.frames.length > 0) {
      forwardToChildFrames(binding.action, binding.value);
    } else {
      return;
    }

    if (binding.force) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  const handleForwardMessage = (event: MessageEvent): void => {
    if (!isHareKeyForwardMessage(event.data)) return;
    // Accept only the direct parent, which forwards through nested frame chains.
    if (window.parent === window || event.source !== window.parent) return;

    const settings = getSettings();
    if (!settings.enabled) return;

    const { action, value } = event.data;

    const controllers = getControllers();
    if (controllers.length > 0) {
      const syntheticBinding: KeyBinding = { action, value, key: '', force: false };
      executeAction(action, syntheticBinding, controllers);
    } else if (window.frames.length > 0) {
      forwardToChildFrames(action, value);
    }
  };

  // Capture on window so document/body handlers cannot hide shortcuts.
  window.addEventListener('keydown', handleKeyDown, { capture: true });
  window.addEventListener('message', handleForwardMessage);

  return {
    handleKeyDown,
    destroy: () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('message', handleForwardMessage);
    },
  };
}
