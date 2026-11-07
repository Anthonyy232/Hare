import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { MediaRegistry } from './registry';
import { DEFAULT_SETTINGS } from '../settings/schema';
import type { SiteHandler } from './site-handlers';

let registry: MediaRegistry;
const invalidated = vi.fn();
const handler: SiteHandler = {
  findContainer: media => media.parentElement,
  shouldIgnoreVideo: media => media.dataset.eligible === 'false',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.spyOn(browser.dom, 'openOrClosedShadowRoot').mockImplementation(element => element.shadowRoot);
  invalidated.mockClear();
  document.body.innerHTML = '<div><video></video><audio></audio></div>';
});
afterEach(() => {
  registry?.destroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('media lifecycle', () => {
  it('reconsiders ignored players on rescan and releases source listeners on destruction', () => {
    const video = document.querySelector('video')!;
    video.dataset.eligible = 'false';
    registry = new MediaRegistry(structuredClone(DEFAULT_SETTINGS), handler, invalidated);
    expect(registry.connectedControllers()).toEqual([]);
    video.dataset.eligible = 'true';
    registry.rescan();
    expect(registry.connectedControllers().map(controller => controller.media)).toEqual([video]);
    registry.rescan();
    expect(document.querySelectorAll('hare-controller')).toHaveLength(1);
    video.dispatchEvent(new Event('emptied'));
    expect(invalidated).toHaveBeenCalledWith(video);
    registry.destroy();
    invalidated.mockClear();
    video.dispatchEvent(new Event('emptied'));
    video.dispatchEvent(new Event('play'));
    registry.rescan();
    expect(invalidated).not.toHaveBeenCalled();
    expect(document.querySelector('hare-controller')).toBeNull();
  });

  it('changes audio eligibility without replacing the video controller', () => {
    registry = new MediaRegistry(structuredClone(DEFAULT_SETTINGS), handler, invalidated);
    const videoController = registry.connectedControllers()[0];
    registry.updateSettings({ ...DEFAULT_SETTINGS, enableAudio: true });
    expect(registry.connectedControllers().map(controller => controller.media.localName)).toEqual(['video', 'audio']);
    expect(registry.connectedControllers()[0]).toBe(videoController);
    registry.updateSettings({ ...DEFAULT_SETTINGS, enableAudio: false });
    expect(registry.connectedControllers()).toEqual([videoController]);
    expect(invalidated).toHaveBeenCalledWith(document.querySelector('audio'));
  });

  it('releases ignored players when their detached subtree is cleaned up', async () => {
    const video = document.querySelector('video')!;
    video.dataset.eligible = 'false';
    registry = new MediaRegistry(structuredClone(DEFAULT_SETTINGS), handler, invalidated);
    video.remove();
    await vi.advanceTimersByTimeAsync(6000);
    expect(invalidated).toHaveBeenCalledWith(video);
    video.dataset.eligible = 'true';
    document.body.append(video);
    video.dispatchEvent(new Event('play'));
    expect(registry.connectedControllers()).toEqual([]);
    registry.rescan();
    expect(registry.connectedControllers().map(controller => controller.media)).toEqual([video]);
  });
});
