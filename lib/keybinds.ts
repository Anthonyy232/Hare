import type { Settings } from './types';
import { ACTIONS, isKeyAction, type KeyAction } from './key-actions';
import type { ActionTarget } from './controller-contracts';

function isInputElement(element: Element): boolean {
  return element.matches('input, textarea, select')
    || (element as HTMLElement).isContentEditable
    || !!element.closest('[contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]');
}

export type KeybindHandler = {
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
    isKeyAction(d.action) &&
    typeof d.value === 'number' && Number.isFinite(d.value) && d.value >= 0
  );
}

function forwardToChildFrames(action: KeyAction, value: number): void {
  const msg: HareKeyForwardMessage = { __hareKeyForward: true, action, value };
  for (let i = 0; i < window.frames.length; i++) {
    window.frames[i].postMessage(msg, '*');
  }
}

export function createKeybindHandler(
  getControllers: () => ActionTarget[],
  getSettings: () => Settings
): KeybindHandler {
  const dispatch = (action: KeyAction, value: number): boolean => {
    const controllers = getControllers();
    if (controllers.length > 0) {
      for (const controller of controllers) controller.perform(action, value);
      return true;
    }
    if (window.frames.length === 0) return false;
    forwardToChildFrames(action, value);
    return true;
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.keyCode === 229 || document.designMode === 'on') return;
    if (event.composedPath().some(target => target instanceof Element && isInputElement(target))) return;

    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;

    const settings = getSettings();
    if (!settings.enabled) return;

    const binding = settings.keyBindings.find(binding => binding.key && binding.key === event.code);
    if (!binding) return;
    if (event.repeat && !ACTIONS[binding.action].repeat) return;

    if (!dispatch(binding.action, binding.value)) return;

    if (binding.force) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  const handleForwardMessage = (event: MessageEvent): void => {
    if (!isHareKeyForwardMessage(event.data)) return;
    // Accept only the direct parent, which forwards through nested frame chains.
    if (window.parent === window || event.source !== window.parent) return;

    if (!getSettings().enabled) return;

    const { action, value } = event.data;
    dispatch(action, value);
  };

  // Capture on window so document/body handlers cannot hide shortcuts.
  window.addEventListener('keydown', handleKeyDown, { capture: true });
  window.addEventListener('message', handleForwardMessage);

  return {
    destroy: () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('message', handleForwardMessage);
    },
  };
}
