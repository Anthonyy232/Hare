import { isKeyAction, type KeyAction } from '../settings/key-actions';
import type { ActionTarget, PointerTarget } from './controller-contracts';

/**
 * A controller action sent down to child frames when it can't run here: focus can stay in a host
 * frame above a cross-origin player, and host overlays can catch clicks meant for its controller.
 * A shortcut goes to every controller in the frame; a button press goes to the controller it was on.
 */
type FrameAction =
  | { action: KeyAction; value: number }
  | { action: KeyAction; controllerId: string };

const MARKER = '__hareAction';

function isFrameAction(data: unknown): data is FrameAction {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d[MARKER] !== true || !isKeyAction(d.action)) return false;
  return 'controllerId' in d
    ? typeof d.controllerId === 'string'
    : typeof d.value === 'number' && Number.isFinite(d.value) && d.value >= 0;
}

export function postFrameAction(target: Window, message: FrameAction): void {
  target.postMessage({ [MARKER]: true, ...message }, '*');
}

/** Runs a shortcut on this frame's controllers, or passes it on to child frames when there are none. */
export function dispatchAction(controllers: ActionTarget[], action: KeyAction, value: number): boolean {
  if (controllers.length > 0) {
    for (const controller of controllers) controller.perform(action, value);
    return true;
  }
  if (window.frames.length === 0) return false;
  for (let i = 0; i < window.frames.length; i++) postFrameAction(window.frames[i], { action, value });
  return true;
}

/** Only the direct parent may send actions: it alone sees this frame's buttons, and it relays nested chains. */
export function listenForParentActions(getControllers: () => PointerTarget[]): () => void {
  const handleMessage = (event: MessageEvent): void => {
    if (window.parent === window || event.source !== window.parent || !isFrameAction(event.data)) return;
    const message = event.data;
    if ('controllerId' in message) {
      getControllers().find(controller => controller.id === message.controllerId)?.press(message.action);
    } else {
      dispatchAction(getControllers(), message.action, message.value);
    }
  };
  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}
