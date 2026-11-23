import { ACTIONS, isShortcutKey, type KeyBinding } from '../settings/key-actions';
import type { ActionTarget } from './controller-contracts';
import { dispatchAction } from './frame-actions';

function isInputElement(element: Element): boolean {
  return (
    element.matches('input, textarea, select') ||
    (element as HTMLElement).isContentEditable ||
    !!element.closest(
      '[contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]',
    )
  );
}

export function listenForShortcuts(getControllers: () => ActionTarget[], getBindings: () => KeyBinding[]): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    // 229 is the keyCode some browsers report for keys an input method is still composing.
    if (!isShortcutKey(event) || event.keyCode === 229 || document.designMode === 'on') return;
    if (event.composedPath().some(target => target instanceof Element && isInputElement(target))) return;

    const binding = getBindings().find(binding => binding.key && binding.key === event.code);
    if (!binding) return;
    if (event.repeat && !ACTIONS[binding.action].repeat) return;
    if (!dispatchAction(getControllers(), binding.action, binding.value)) return;

    if (binding.force) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  // Capture on window so document/body handlers cannot hide shortcuts.
  window.addEventListener('keydown', handleKeyDown, { capture: true });
  return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
}
