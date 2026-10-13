import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeybindHandler, type KeybindHandler } from './keybinds';
import { DEFAULT_SETTINGS } from './types';
import type { VideoController } from './controller';

describe('keyboard ownership', () => {
  const controller = { perform: vi.fn() };
  let handler: KeybindHandler;
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    handler = createKeybindHandler(() => [controller as unknown as VideoController], () => DEFAULT_SETTINGS);
  });
  afterEach(() => handler.destroy());
  function press(target: Element, options: KeyboardEventInit = {}) {
    target.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', bubbles: true, composed: true, ...options }));
  }
  it('runs ordinary shortcuts', () => {
    press(document.body);
    expect(controller.perform).toHaveBeenCalledWith('faster', 0.1);
  });
  it.each(['input', 'textarea', 'select'])('ignores %s', tag => {
    const element = document.createElement(tag); document.body.append(element); press(element);
    expect(controller.perform).not.toHaveBeenCalled();
  });
  it.each(['', 'true', 'plaintext-only'])('ignores descendants of contenteditable=%s', editable => {
    document.body.innerHTML = `<div contenteditable="${editable}"><span>Typing</span></div>`;
    press(document.querySelector('span')!);
    expect(controller.perform).not.toHaveBeenCalled();
  });
  it('ignores composing input and modifier combinations', () => {
    for (const option of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'isComposing']) press(document.body, { [option]: true });
    expect(controller.perform).not.toHaveBeenCalled();
  });
  it('does not flicker visibility on held shortcuts', () => {
    press(document.body, { code: 'KeyV', repeat: true });
    expect(controller.perform).not.toHaveBeenCalled();
  });
  it('rejects forwards from a page to its own top window', () => {
    window.dispatchEvent(new MessageEvent('message', { source: window, data: { __hareKeyForward: true, action: 'faster', value: 1 } }));
    expect(controller.perform).not.toHaveBeenCalled();
  });
});
