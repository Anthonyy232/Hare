import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction, listenForParentActions } from './frame-actions';

describe('actions from the parent frame', () => {
  const controller = { id: 'hare-test', perform: vi.fn(), press: vi.fn(), getButtonHitmap: () => [] };
  const parent = { postMessage: vi.fn() } as unknown as Window;
  let stop: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
    stop = listenForParentActions(() => [controller]);
  });
  afterEach(() => {
    stop();
    vi.restoreAllMocks();
  });
  const post = (source: unknown, data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { source: source as Window, data }));

  it('runs shortcuts and button presses from the direct parent', () => {
    post(parent, { __hareAction: true, action: 'faster', value: 0.5 });
    post(parent, { __hareAction: true, action: 'slower', controllerId: 'hare-test', value: 9 });
    expect(controller.perform).toHaveBeenCalledWith('faster', 0.5);
    expect(controller.press).toHaveBeenCalledWith('slower');
  });

  it('ignores actions from any other window and malformed actions', () => {
    post(window, { __hareAction: true, action: 'faster', value: 1 });
    post(parent, { __hareAction: true, action: 'faster', value: -1 });
    post(parent, { __hareAction: true, action: 'explode', value: 1 });
    post(parent, { __hareAction: true, action: 'faster', controllerId: 5, value: 1 });
    expect(controller.perform).not.toHaveBeenCalled();
    expect(controller.press).not.toHaveBeenCalled();
  });
});

describe('dispatching a shortcut', () => {
  afterEach(() => vi.restoreAllMocks());

  it('relays to child frames only when this frame has no controllers', () => {
    const send = vi.fn();
    vi.spyOn(window, 'frames', 'get').mockReturnValue({ length: 1, 0: { postMessage: send } } as unknown as Window);
    const controller = { perform: vi.fn() };
    expect(dispatchAction([controller], 'faster', 0.1)).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(dispatchAction([], 'faster', 0.1)).toBe(true);
    expect(send).toHaveBeenCalledWith({ __hareAction: true, action: 'faster', value: 0.1 }, '*');
  });
});
