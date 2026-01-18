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
 * Captures keyboard events globally to trigger speed control actions.
 */
export function createKeybindHandler(
  getControllers: () => VideoController[],
  getSettings: () => Settings
): KeybindHandler {
  const handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (!target || !(target instanceof Element) || isInputElement(target)) return;

    // Ignore commands with active system modifiers.
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    const settings = getSettings();
    if (!settings.enabled) return;

    const controllers = getControllers();
    if (controllers.length === 0) return;

    const binding = findBinding(event, settings.keyBindings);
    if (!binding) return;

    executeAction(binding.action, binding, controllers);

    if (binding.force) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  /** Use capture phase to intercept keys before site-specific listeners. */
  document.addEventListener('keydown', handleKeyDown, true);

  return {
    handleKeyDown,
    destroy: () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    },
  };
}
