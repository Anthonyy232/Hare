import type { Settings, KeyAction, KeyBinding } from './types';
import type { VideoController } from './controller';

/**
 * Checks if the focus is on a user input field to avoid intercepting 
 * keys while the user is typing.
 */
function isInputElement(element: Element | null): boolean {
  if (!element) return false;

  const tagName = element.tagName.toUpperCase();
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  if (element.getAttribute('contenteditable') === 'true') return true;

  const role = element.getAttribute('role');
  return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}

function findBinding(event: KeyboardEvent, bindings: KeyBinding[]): KeyBinding | null {
  for (const binding of bindings) {
    if (event.code === binding.key) return binding;
  }
  return null;
}

function executeAction(
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
        controller.resetSpeed();
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

/**
 * Cross-frame action forward used when a frame recognizes a binding but has
 * no local controllers — e.g., Google Drive's viewer where the <video> lives
 * inside a cross-origin YouTube embed iframe that never receives focus.
 */
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
    typeof d.value === 'number'
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

/**
 * Captures keyboard events globally to trigger speed control actions.
 */
export function createKeybindHandler(
  getControllers: () => VideoController[],
  getSettings: () => Settings
): KeybindHandler {
  const handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    // Allow typing in inputs unless it's a modifier-only event or special case?
    // No, standard behavior is to ignore inputs.
    if (!target || !(target instanceof Element) || isInputElement(target)) return;

    // Ignore commands with active system modifiers.
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    const settings = getSettings();
    if (!settings.enabled) return;

    const binding = findBinding(event, settings.keyBindings);
    if (!binding) return;

    const controllers = getControllers();
    if (controllers.length > 0) {
      executeAction(binding.action, binding, controllers);
    } else if (window.frames.length > 0) {
      // Video is in a child iframe (e.g. Google Drive's cross-origin YouTube
      // embed). The iframe never sees this keydown because focus stays on
      // the host frame, so push the resolved action down through postMessage.
      forwardToChildFrames(binding.action, binding.value);
    } else {
      return;
    }

    // If forced, blocking the site from seeing this event
    if (binding.force) {
      event.preventDefault();
      event.stopImmediatePropagation();
    } else {
      // Even if not forced, we might want to prevent default browser behaviors
      // (like scrolling for space/arrows) if we handled it?
      // For now, adhere to "force" setting for side-effects,
      // but "rewind/advance" on arrow keys usually requires prevention to stop scrolling.
      // However, making that assumption might annoy users who map non-standard keys.
      // Let's stick to the "force" flag as the source of truth for suppression.
    }
  };

  const handleForwardMessage = (event: MessageEvent): void => {
    if (!isHareKeyForwardMessage(event.data)) return;
    // Only accept forwards from an ancestor (parent or top). This rejects
    // random messages from peer/child frames or unrelated page scripts.
    if (event.source !== window.parent && event.source !== window.top) return;

    const settings = getSettings();
    if (!settings.enabled) return;

    const { action, value } = event.data;

    const controllers = getControllers();
    if (controllers.length > 0) {
      const syntheticBinding: KeyBinding = { action, value, key: '', force: false };
      executeAction(action, syntheticBinding, controllers);
    } else if (window.frames.length > 0) {
      // Pass it deeper — supports nested iframe chains.
      forwardToChildFrames(action, value);
    }
  };

  /**
   * Use capture phase on WINDOW to intercept keys before ANY site scripts.
   * This ensures we see the event even if the site stops propagation on document/body.
   */
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
