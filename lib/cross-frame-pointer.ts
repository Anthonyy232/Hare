import type { VideoController } from './controller';
import type { KeyAction, KeyBinding } from './types';
import { executeAction } from './keybinds';
import { CROSS_FRAME } from './constants';

/**
 * Cross-frame pointer bridge.
 *
 * Sites like Google Drive render the <video> inside a cross-origin iframe
 * (e.g. youtube.googleapis.com/embed/) and keep focus pinned on a top-frame
 * <section>, so pointerdown/click events fired on what visually looks like
 * Hare's badge never reach the frame where the badge actually lives. The
 * bridge closes that gap:
 *
 *   - Each frame that owns VideoControllers publishes a "button hitmap"
 *     (per-button rects in its own viewport) to its parent window.
 *   - Each frame listens for hitmaps from its direct child frames, tracks
 *     them, and at capture phase intercepts document-level clicks whose
 *     coordinates fall inside a registered button's rect. When one hits,
 *     it cancels the host-frame event and posts the resolved action down
 *     into the child frame for local execution.
 *
 * Only direct-parent / direct-child relationships are handled. Nested
 * chains aren't relayed — that's a separate feature.
 */

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

const VALID_ACTIONS: ReadonlySet<KeyAction> = new Set([
  'slower', 'faster', 'rewind', 'advance', 'reset', 'display',
]);

function isHareHitmapMessage(data: unknown): data is HareHitmapMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.__hareHitmap !== true || !Array.isArray(d.buttons) || d.buttons.length > 1000) return false;
  for (const b of d.buttons) {
    if (typeof b !== 'object' || b === null) return false;
    const btn = b as Record<string, unknown>;
    if (
      typeof btn.controllerId !== 'string' ||
      typeof btn.action !== 'string' ||
      !VALID_ACTIONS.has(btn.action as KeyAction) ||
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
    typeof d.action === 'string' &&
    VALID_ACTIONS.has(d.action as KeyAction) &&
    typeof d.value === 'number' && Number.isFinite(d.value) && d.value >= 0
  );
}

export type CrossFramePointerBridge = {
  destroy: () => void;
};

export function createCrossFramePointerBridge(
  getControllers: () => VideoController[]
): CrossFramePointerBridge {
  // --- Publisher: advertise our controllers' button geometry to the parent ---
  let publishInterval: ReturnType<typeof setInterval> | null = null;
  // Init to '[]' so a frame that never has visible buttons stays silent on destroy.
  let lastPublishedJson = '[]';

  const publishHitmap = (): void => {
    if (window.parent === window) return;

    const controllers = getControllers();
    const buttons: HitmapButton[] = [];
    for (const controller of controllers) {
      const hitmap = controller.getButtonHitmap();
      if (hitmap) buttons.push(...hitmap);
    }

    const json = JSON.stringify(buttons);
    if (json === lastPublishedJson) return;
    lastPublishedJson = json;

    const payload: HareHitmapMessage = { __hareHitmap: true, buttons };
    try {
      window.parent.postMessage(payload, '*');
    } catch {}
  };

  if (window.parent !== window) {
    publishHitmap();
    publishInterval = setInterval(publishHitmap, CROSS_FRAME.HITMAP_POLL_MS);
  }

  // --- Interceptor: track child hitmaps and hijack matching pointer events ---
  type ChildEntry = {
    iframe: HTMLIFrameElement;
    buttons: HitmapButton[];
  };
  const childHitmaps = new Map<Window, ChildEntry>();
  const iframeByWindow = new WeakMap<Window, HTMLIFrameElement>();

  const resolveIframe = (win: Window): HTMLIFrameElement | null => {
    const cached = iframeByWindow.get(win);
    if (cached && cached.isConnected) return cached;
    const iframes = document.querySelectorAll('iframe');
    for (const frame of iframes) {
      try {
        if ((frame as HTMLIFrameElement).contentWindow === win) {
          iframeByWindow.set(win, frame as HTMLIFrameElement);
          return frame as HTMLIFrameElement;
        }
      } catch {}
    }
    return null;
  };

  const handleMessage = (event: MessageEvent): void => {
    if (isHareHitmapMessage(event.data)) {
      if (!(event.source instanceof Window)) return;
      if (event.data.buttons.length === 0) {
        childHitmaps.delete(event.source);
        return;
      }
      const iframe = resolveIframe(event.source);
      if (!iframe) return;
      childHitmaps.set(event.source, { iframe, buttons: event.data.buttons });
      return;
    }

    if (isHareActionMessage(event.data)) {
      // Only accept forwarded actions from the direct parent. Mirrors the
      // ancestor check in keybinds.handleForwardMessage; window.top is
      // intentionally excluded to avoid trusting a distant, non-ancestor frame.
      if (window.parent === window || event.source !== window.parent) return;
      const controllers = getControllers().filter(controller => controller.id === event.data.controllerId);
      if (controllers.length === 0) return;
      const synthetic: KeyBinding = { action: event.data.action, value: event.data.value, key: '', force: false };
      executeAction(event.data.action, synthetic, controllers);
    }
  };

  const hitTestChildFrames = (
    clientX: number,
    clientY: number
  ): { source: Window; action: KeyAction; value: number; controllerId: string } | null => {
    for (const [source, entry] of childHitmaps) {
      if (!entry.iframe.isConnected) {
        childHitmaps.delete(source);
        continue;
      }
      const rect = entry.iframe.getBoundingClientRect();
      if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
      const scaleX = rect.width / (entry.iframe.offsetWidth || rect.width);
      const scaleY = rect.height / (entry.iframe.offsetHeight || rect.height);
      for (const btn of entry.buttons) {
        const left = rect.left + (entry.iframe.clientLeft + btn.x) * scaleX;
        const top = rect.top + (entry.iframe.clientTop + btn.y) * scaleY;
        if (
          clientX >= left &&
          clientX <= left + btn.w * scaleX &&
          clientY >= top &&
          clientY <= top + btn.h * scaleY
        ) {
          return { source, action: btn.action, value: btn.value, controllerId: btn.controllerId };
        }
      }
    }
    return null;
  };

  const forwardAction = (target: Window, action: KeyAction, value: number, controllerId: string): void => {
    const msg: HareActionMessage = { __hareButtonAction: true, action, value, controllerId };
    try {
      target.postMessage(msg, '*');
    } catch {}
  };

  // pointerdown/mousedown: stop host delegation (e.g. Drive's jsaction) from
  // running, but do NOT preventDefault — that would cancel the synthesized
  // click we depend on.
  const handleEarlyPress = (event: Event): void => {
    if (childHitmaps.size === 0) return;
    const me = event as MouseEvent;
    if (!hitTestChildFrames(me.clientX, me.clientY)) return;
    event.stopImmediatePropagation();
  };

  // click: this is where we commit — cancel and forward the action.
  const handleClick = (event: Event): void => {
    if (childHitmaps.size === 0) return;
    const me = event as MouseEvent;
    const hit = hitTestChildFrames(me.clientX, me.clientY);
    if (!hit) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    forwardAction(hit.source, hit.action, hit.value, hit.controllerId);
  };

  window.addEventListener('message', handleMessage);
  document.addEventListener('pointerdown', handleEarlyPress, { capture: true });
  document.addEventListener('mousedown', handleEarlyPress, { capture: true });
  document.addEventListener('click', handleClick, { capture: true });

  return {
    destroy: () => {
      if (publishInterval !== null) {
        clearInterval(publishInterval);
        publishInterval = null;
      }
      // Tell the parent to drop our entry, but only if we ever published a
      // non-empty hitmap (otherwise the parent has nothing to forget).
      if (window.parent !== window && lastPublishedJson !== '[]') {
        try {
          window.parent.postMessage({ __hareHitmap: true, buttons: [] }, '*');
        } catch {}
      }
      window.removeEventListener('message', handleMessage);
      document.removeEventListener('pointerdown', handleEarlyPress, { capture: true });
      document.removeEventListener('mousedown', handleEarlyPress, { capture: true });
      document.removeEventListener('click', handleClick, { capture: true });
      childHitmaps.clear();
      lastPublishedJson = '[]';
    },
  };
}
