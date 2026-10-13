import { describe, it, expect, beforeEach } from 'vitest';
import { ObserverPool } from './observer-pool';
import { OBSERVER } from './constants';
import { setTimeout as delay } from 'node:timers/promises';

// happy-dom has no idle callbacks; browsers run them by IDLE_TIMEOUT_MS at the latest.
globalThis.requestIdleCallback ??= callback => setTimeout(callback, OBSERVER.IDLE_TIMEOUT_MS);
globalThis.cancelIdleCallback ??= id => clearTimeout(id);
const flushObserver = () => delay(OBSERVER.IDLE_TIMEOUT_MS + 20);

describe('ObserverPool', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('observes pre-existing nested shadow roots and releases removed hosts', async () => {
    const found: HTMLMediaElement[] = [], removed: HTMLMediaElement[] = [];
    const host = document.createElement('div'); document.body.append(host);
    const outer = host.attachShadow({ mode: 'open' });
    const innerHost = document.createElement('div'); outer.append(innerHost);
    const inner = innerHost.attachShadow({ mode: 'open' });
    const pool = new ObserverPool(media => found.push(media), media => removed.push(media));
    pool.observe(document);
    const video = document.createElement('video'); inner.append(video);
    await flushObserver();
    expect(found).toEqual([video]);
    host.remove();
    await flushObserver();
    expect(removed).toEqual([video]);
    inner.append(document.createElement('video'));
    await flushObserver();
    expect(found).toHaveLength(1);
    pool.disconnect();
  });

  it('does not report media added and removed before the batch flushes', async () => {
    const found: HTMLMediaElement[] = [];
    const pool = new ObserverPool(media => found.push(media), () => {});
    pool.observe(document);
    const video = document.createElement('video'); document.body.append(video); video.remove();
    await flushObserver();
    expect(found).toEqual([]);
    pool.disconnect();
  });

  it('does not report a removed media element when it is reparented', async () => {
    const found: HTMLMediaElement[] = [];
    const removed: HTMLMediaElement[] = [];
    const pool = new ObserverPool(
      media => found.push(media),
      media => removed.push(media),
    );
    const firstParent = document.createElement('div');
    const secondParent = document.createElement('div');
    document.body.append(firstParent, secondParent);

    pool.observe(document);
    const video = document.createElement('video');
    firstParent.appendChild(video);
    await flushObserver();

    secondParent.appendChild(video);
    await flushObserver();

    expect(found).toEqual([video]);
    expect(removed).toEqual([]);
    pool.disconnect();
  });
});
