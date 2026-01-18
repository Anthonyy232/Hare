import { OBSERVER } from './constants';
import { getShadowRoot } from './shadow-dom';
import { BrowserFeatures } from './browser-detect';

type MediaFoundCallback = (media: HTMLMediaElement) => void;
type MediaRemovedCallback = (media: HTMLMediaElement) => void;

/**
 * A centralized MutationObserver pool that efficiently tracks media elements across
 * the main document and all discovered Shadow DOMs. Batches mutations to minimize
 * callback thrashing in content-heavy pages.
 */
export class ObserverPool {
  private observer: MutationObserver;
  private pendingMutations: MutationRecord[] = [];
  private flushScheduled = false;
  private flushTimeoutId: number | NodeJS.Timeout | null = null;
  private observedShadowRoots = new WeakSet<ShadowRoot>();
  private trackedMedia = new WeakSet<HTMLMediaElement>();
  private onMediaFound: MediaFoundCallback;
  private onMediaRemoved: MediaRemovedCallback;
  private includeAudio: boolean;

  constructor(
    onMediaFound: MediaFoundCallback,
    onMediaRemoved: MediaRemovedCallback,
    includeAudio = false
  ) {
    this.onMediaFound = onMediaFound;
    this.onMediaRemoved = onMediaRemoved;
    this.includeAudio = includeAudio;
    this.observer = new MutationObserver(this.handleMutations.bind(this));
  }

  /**
   * Registers a root for observation. Automatically handles recursive Shadow DOM discovery.
   */
  observe(root: Document | ShadowRoot): void {
    if (root instanceof ShadowRoot) {
      if (this.observedShadowRoots.has(root)) return;
      this.observedShadowRoots.add(root);
    }

    this.observer.observe(root, { childList: true, subtree: true });
  }

  disconnect(): void {
    if (this.flushTimeoutId !== null) {
      if (BrowserFeatures.hasRequestIdleCallback) {
        cancelIdleCallback(this.flushTimeoutId as number);
      } else {
        clearTimeout(this.flushTimeoutId as NodeJS.Timeout);
      }
      this.flushTimeoutId = null;
    }
    this.observer.disconnect();
    this.pendingMutations = [];
    this.flushScheduled = false;
  }

  /**
   * Batches mutation records to prevent expensive DOM scans on every minor change.
   */
  private handleMutations(mutations: MutationRecord[]): void {
    this.pendingMutations.push(...mutations);

    if (!this.flushScheduled) {
      this.flushScheduled = true;
      // requestIdleCallback added in Firefox 55+ (2017), Safari 13+ (2019)
      // Fallback to setTimeout for older browsers
      if (BrowserFeatures.hasRequestIdleCallback) {
        this.flushTimeoutId = requestIdleCallback(() => this.flush(), { timeout: OBSERVER.IDLE_TIMEOUT_MS });
      } else {
        this.flushTimeoutId = setTimeout(() => this.flush(), OBSERVER.DEBOUNCE_MS);
      }
    }
  }

  /**
   * Processes the mutation queue and identifies new or removed media elements.
   */
  private flush(): void {
    this.flushScheduled = false;
    this.flushTimeoutId = null;
    const mutations = this.pendingMutations;
    this.pendingMutations = [];

    const foundMedia = new Set<HTMLMediaElement>();
    const removedMedia = new Set<HTMLMediaElement>();
    const selector = this.includeAudio ? 'video, audio' : 'video';

    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (!(node instanceof Element)) continue;

        if (this.isTrackedMedia(node)) {
          removedMedia.add(node as HTMLMediaElement);
        }

        const mediaInSubtree = node.querySelectorAll(selector);
        for (const media of mediaInSubtree) {
          if (this.trackedMedia.has(media as HTMLMediaElement)) {
            removedMedia.add(media as HTMLMediaElement);
          }
        }
      }

      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;

        if (this.isTargetMedia(node)) {
          foundMedia.add(node as HTMLMediaElement);
        }

        const mediaElements = node.querySelectorAll(selector);
        for (const media of mediaElements) {
          foundMedia.add(media as HTMLMediaElement);
        }

        this.discoverShadowRoots(node, selector, foundMedia);
      }
    }

    for (const media of removedMedia) {
      this.trackedMedia.delete(media);
      this.onMediaRemoved(media);
    }

    for (const media of foundMedia) {
      if (!this.trackedMedia.has(media)) {
        this.trackedMedia.add(media);
        this.onMediaFound(media);
      }
    }
  }

  /**
   * Recursively crawls the subtree to find and attach observers to Shadow Roots.
   * This is critical for sites like YouTube or Netflix that heavily use web components.
   */
  private discoverShadowRoots(
    root: Element,
    selector: string,
    foundMedia: Set<HTMLMediaElement>,
    depth = 0
  ): void {
    if (depth > OBSERVER.MAX_SHADOW_DEPTH) return;

    const shadow = getShadowRoot(root);
    if (shadow && !this.observedShadowRoots.has(shadow)) {
      this.observe(shadow);
      const shadowMedia = shadow.querySelectorAll(selector);
      for (const media of shadowMedia) {
        foundMedia.add(media as HTMLMediaElement);
      }
    }

    for (const child of root.children) {
      this.discoverShadowRoots(child, selector, foundMedia, depth + 1);
    }
  }

  private isTargetMedia(node: Element): boolean {
    return (
      node instanceof HTMLVideoElement ||
      (this.includeAudio && node instanceof HTMLAudioElement)
    );
  }

  private isTrackedMedia(node: Element): boolean {
    return (
      (node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) &&
      this.trackedMedia.has(node as HTMLMediaElement)
    );
  }
}
