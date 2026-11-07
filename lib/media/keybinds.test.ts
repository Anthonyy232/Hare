import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForShortcuts } from './keybinds';
import { DEFAULT_SETTINGS } from '../settings/schema';

describe('keyboard ownership', () => {
  const controller = { id: 'hare-test', perform: vi.fn(), press: vi.fn(), getButtonHitmap: () => [] };
  let stop: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    stop = listenForShortcuts(() => [controller], () => DEFAULT_SETTINGS.keyBindings);
  });
  afterEach(() => stop());
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
});
