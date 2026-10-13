import type { VideoController } from './controller';
import { isKeyAction, type KeyAction } from './types';
import { CROSS_FRAME } from './constants';

// Host overlays can intercept clicks above cross-origin players. Child frames publish
// button bounds so their direct parent can forward the matching controller action.

export type HitmapButton = {
  controllerId: string;
  action: KeyAction;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

type HareHitmapMessage = {
  __hareHitmap: true;
  buttons: HitmapButton[];
};

type HareActionMessage = {
  __hareButtonAction: true;
  controllerId: string;
  action: KeyAction;
  value: number;
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
      typeof btn.value !== 'number' ||
      typeof btn.x !== 'number' ||
      typeof btn.y !== 'number' ||
      typeof btn.w !== 'number' ||
      typeof btn.h !== 'number' ||
      ![btn.value, btn.x, btn.y, btn.w, btn.h].every(Number.isFinite) ||
      btn.w < 0 || btn.h < 0 || btn.value < 0
    ) return false;
  }
  return true;
}

function isHareActionMessage(data: unknown): data is HareActionMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    d.__hareButtonAction === true &&
    typeof d.controllerId === 'string' &&
    isKeyAction(d.action) &&
    typeof d.value === 'number' && Number.isFinite(d.value) && d.value >= 0
  );
}

export type CrossFramePointerBridge = {
  destroy: () => void;
};

export function createCrossFramePointerBridge(
  getControllers: () => VideoController[]
): CrossFramePointerBridge {
  const isChildFrame = window.parent !== window;
  // Start at '[]' so a frame that never shows buttons stays silent on destroy.
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
    publishInterval = setInterval(publishHitmap, CROSS_FRAME.HITMAP_POLL_MS);
  }

  const childHitmaps = new Map<Window, { iframe: HTMLIFrameElement; buttons: HitmapButton[] }>();

  const handleMessage = (event: MessageEvent): void => {
    if (isHareHitmapMessage(event.data)) {
      const source = event.source;
      if (!(source instanceof Window)) return;
      const iframe = [...document.querySelectorAll('iframe')].find(frame => frame.contentWindow === source);
      if (event.data.buttons.length && iframe) childHitmaps.set(source, { iframe, buttons: event.data.buttons });
      else childHitmaps.delete(source);
      return;
    }

    if (isHareActionMessage(event.data)) {
      // Hitmaps describe direct children, so only the direct parent may forward actions.
      if (!isChildFrame || event.source !== window.parent) return;
      const { controllerId, action, value } = event.data;
      getControllers().find(controller => controller.id === controllerId)?.perform(action, value);
    }
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
    const { controllerId, action, value } = hit.button;
    const message: HareActionMessage = { __hareButtonAction: true, controllerId, action, value };
    hit.source.postMessage(message, '*');
  };

  const listeners = new AbortController();
  const { signal } = listeners;
  window.addEventListener('message', handleMessage, { signal });
  document.addEventListener('pointerdown', handleEarlyPress, { capture: true, signal });
  document.addEventListener('mousedown', handleEarlyPress, { capture: true, signal });
  document.addEventListener('click', handleClick, { capture: true, signal });

  return {
    destroy: () => {
      if (publishInterval !== null) clearInterval(publishInterval);
      if (isChildFrame && lastPublishedJson !== '[]') publish([]);
      lastPublishedJson = '[]';
      listeners.abort();
      childHitmaps.clear();
    },
  };
}
