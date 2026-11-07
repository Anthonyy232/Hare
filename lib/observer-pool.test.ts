import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObserverPool } from './observer-pool';
describe('ObserverPool', () => {
  let pool: ObserverPool;
  afterEach(() => pool?.disconnect());
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('observes pre-existing nested shadow roots and releases removed hosts', async () => {
    const found: HTMLMediaElement[] = [], removed: HTMLMediaElement[] = [];
    const host = document.createElement('div'); document.body.append(host);
    const outer = host.attachShadow({ mode: 'open' });
    const innerHost = document.createElement('div'); outer.append(innerHost);
    const inner = innerHost.attachShadow({ mode: 'open' });
    pool = new ObserverPool(media => found.push(media), media => removed.push(media));
    pool.observe(document);
    const video = document.createElement('video'); inner.append(video);
    await vi.waitFor(() => expect(found).toEqual([video]));
    host.remove();
    await vi.waitFor(() => expect(removed).toEqual([video]));
    inner.append(document.createElement('video'));
    const survivor = document.createElement('video'); document.body.append(survivor);
    await vi.waitFor(() => expect(found).toEqual([video, survivor]));
  });

  it('does not report media added and removed before the batch flushes', async () => {
    const found: HTMLMediaElement[] = [];
    pool = new ObserverPool(media => found.push(media), () => {});
    pool.observe(document);
    const video = document.createElement('video'); document.body.append(video); video.remove();
    const survivor = document.createElement('video'); document.body.append(survivor);
    await vi.waitFor(() => expect(found).toEqual([survivor]));
  });

  it('does not report a removed media element when it is reparented', async () => {
    const found: HTMLMediaElement[] = [];
    const removed: HTMLMediaElement[] = [];
    pool = new ObserverPool(
      media => found.push(media),
      media => removed.push(media),
    );
    const firstParent = document.createElement('div');
    const secondParent = document.createElement('div');
    document.body.append(firstParent, secondParent);

    pool.observe(document);
    const video = document.createElement('video');
    firstParent.appendChild(video);
    await vi.waitFor(() => expect(found).toEqual([video]));

    secondParent.appendChild(video);
    const survivor = document.createElement('video'); secondParent.append(survivor);
    await vi.waitFor(() => expect(found).toEqual([video, survivor]));
    expect(removed).toEqual([]);
  });
});
