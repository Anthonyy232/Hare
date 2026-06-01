import { describe, it, expect, beforeEach } from 'vitest';
import { ObserverPool } from './observer-pool';
import { OBSERVER } from './constants';

const flushObserver = async () => {
  await Promise.resolve();
  await new Promise(resolve =>
    setTimeout(resolve, Math.max(OBSERVER.DEBOUNCE_MS, OBSERVER.IDLE_TIMEOUT_MS) + 20)
  );
};

describe('ObserverPool', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reports media added to the observed document', async () => {
    const found: HTMLMediaElement[] = [];
    const removed: HTMLMediaElement[] = [];
    const pool = new ObserverPool(
      media => found.push(media),
      media => removed.push(media),
    );

    pool.observe(document);
    const video = document.createElement('video');
    document.body.appendChild(video);

    await flushObserver();

    expect(found).toEqual([video]);
    expect(removed).toEqual([]);
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

  it('reports a tracked media element when it is actually disconnected', async () => {
    const found: HTMLMediaElement[] = [];
    const removed: HTMLMediaElement[] = [];
    const pool = new ObserverPool(
      media => found.push(media),
      media => removed.push(media),
    );

    pool.observe(document);
    const video = document.createElement('video');
    document.body.appendChild(video);
    await flushObserver();

    video.remove();
    await flushObserver();

    expect(found).toEqual([video]);
    expect(removed).toEqual([video]);
    pool.disconnect();
  });
});
