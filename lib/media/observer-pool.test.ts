import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObserverPool } from './observer-pool';
describe('ObserverPool', () => {
  let pool: ObserverPool;
  afterEach(() => pool?.disconnect());
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('observes pre-existing nested shadow roots and signals removals', async () => {
    const found: HTMLMediaElement[] = [];
    const onNodesRemoved = vi.fn();
    const host = document.createElement('div'); document.body.append(host);
    const outer = host.attachShadow({ mode: 'open' });
    const innerHost = document.createElement('div'); outer.append(innerHost);
    const inner = innerHost.attachShadow({ mode: 'open' });
    pool = new ObserverPool(media => found.push(media), onNodesRemoved);
    pool.scan();
    const video = document.createElement('video'); inner.append(video);
    await vi.waitFor(() => expect(found).toEqual([video]));
    expect(onNodesRemoved).not.toHaveBeenCalled();
    host.remove();
    await vi.waitFor(() => expect(onNodesRemoved).toHaveBeenCalledOnce());
    const survivor = document.createElement('video'); document.body.append(survivor);
    await vi.waitFor(() => expect(found).toEqual([video, survivor]));
  });

  it('does not report media added and removed before the batch flushes', async () => {
    const found: HTMLMediaElement[] = [];
    pool = new ObserverPool(media => found.push(media), () => {});
    pool.scan();
    const video = document.createElement('video'); document.body.append(video); video.remove();
    const survivor = document.createElement('video'); document.body.append(survivor);
    await vi.waitFor(() => expect(found).toEqual([survivor]));
  });
});
