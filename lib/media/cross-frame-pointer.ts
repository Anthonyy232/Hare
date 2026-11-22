import type { HitmapButton, PointerTarget } from './controller-contracts';
import { isKeyAction } from '../settings/key-actions';
import { postFrameAction } from './frame-actions';

// Host overlays can intercept clicks above cross-origin players. Child frames publish
// button bounds so their direct parent can forward the matching controller action.

const HITMAP_POLL_MS = 500;

type HareHitmapMessage = {
  __hareHitmap: true;
  buttons: HitmapButton[];
};

function isHareHitmapMessage(data: unknown): data is HareHitmapMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.__hareHitmap !== true || !Array.isArray(d.buttons) || d.buttons.length > 1000) return false;
  for (const b of d.buttons) {
    if (typeof b !== 'object' || b === null) return false;
    const btn = b as Record<string, unknown>;
    if (
      typeof btn.controllerId !== 'string' ||
      !isKeyAction(btn.action) ||
      typeof btn.x !== 'number' ||
      typeof btn.y !== 'number' ||
      typeof btn.w !== 'number' ||
      typeof btn.h !== 'number' ||
      ![btn.x, btn.y, btn.w, btn.h].every(Number.isFinite) ||
      btn.w < 0 || btn.h < 0
    ) return false;
  }
  return true;
}

export function bridgeCrossFramePointers(getControllers: () => PointerTarget[]): () => void {
  const isChildFrame = window.parent !== window;
  let lastPublishedJson = '[]';

  const publish = (buttons: HitmapButton[]): void => {
    const message: HareHitmapMessage = { __hareHitmap: true, buttons };
    window.parent.postMessage(message, '*');
  };

  const publishHitmap = (): void => {
    const buttons = getControllers().flatMap(controller => controller.getButtonHitmap());
    const json = JSON.stringify(buttons);
    if (json === lastPublishedJson) return;
    lastPublishedJson = json;
    publish(buttons);
  };

  let publishInterval: ReturnType<typeof setInterval> | null = null;
  if (isChildFrame) {
    publishHitmap();
    publishInterval = setInterval(publishHitmap, HITMAP_POLL_MS);
  }

  const childHitmaps = new Map<Window, { iframe: HTMLIFrameElement; buttons: HitmapButton[] }>();

  const handleMessage = (event: MessageEvent): void => {
    if (!isHareHitmapMessage(event.data)) return;
    const source = event.source;
    if (!(source instanceof Window)) return;
    const iframe = [...document.querySelectorAll('iframe')].find(frame => frame.contentWindow === source);
    if (event.data.buttons.length && iframe) childHitmaps.set(source, { iframe, buttons: event.data.buttons });
    else childHitmaps.delete(source);
  };

  const hitTestChildFrames = ({ clientX, clientY }: MouseEvent): { source: Window; button: HitmapButton } | null => {
    for (const [source, { iframe, buttons }] of childHitmaps) {
      if (!iframe.isConnected) {
        childHitmaps.delete(source);
        continue;
      }
      const rect = iframe.getBoundingClientRect();
      if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
      const scaleX = rect.width / (iframe.offsetWidth || rect.width);
      const scaleY = rect.height / (iframe.offsetHeight || rect.height);
      for (const button of buttons) {
        const left = rect.left + (iframe.clientLeft + button.x) * scaleX;
        const top = rect.top + (iframe.clientTop + button.y) * scaleY;
        if (clientX >= left && clientX <= left + button.w * scaleX && clientY >= top && clientY <= top + button.h * scaleY) {
          return { source, button };
        }
      }
    }
    return null;
  };

  // Stop host delegation (e.g. Drive's jsaction) on press, but don't preventDefault:
  // that would cancel the synthesized click we depend on.
  const handleEarlyPress = (event: MouseEvent): void => {
    if (childHitmaps.size && hitTestChildFrames(event)) event.stopImmediatePropagation();
  };

  const handleClick = (event: MouseEvent): void => {
    const hit = childHitmaps.size ? hitTestChildFrames(event) : null;
    if (!hit) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const { controllerId, action } = hit.button;
    postFrameAction(hit.source, { controllerId, action });
  };

  const listeners = new AbortController();
  const { signal } = listeners;
  window.addEventListener('message', handleMessage, { signal });
  document.addEventListener('pointerdown', handleEarlyPress, { capture: true, signal });
  document.addEventListener('mousedown', handleEarlyPress, { capture: true, signal });
  document.addEventListener('click', handleClick, { capture: true, signal });

  return () => {
    if (publishInterval !== null) clearInterval(publishInterval);
    if (isChildFrame && lastPublishedJson !== '[]') publish([]);
    listeners.abort();
    childHitmaps.clear();
  };
}
