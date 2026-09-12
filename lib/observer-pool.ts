import { OBSERVER } from './constants';
import { scanMediaTree } from './media-detector';
import { getShadowRoot } from './shadow-dom';
import { BrowserFeatures } from './browser-detect';

type MediaCallback = (media: HTMLMediaElement) => void;

/** One observer per root allows detached shadow trees to be released independently. */
export class ObserverPool {
  private observers = new Map<Document | ShadowRoot, MutationObserver>();
  private pendingMutations: MutationRecord[] = [];
  private flushTimeoutId: ReturnType<typeof setTimeout> | number | null = null;
  private trackedMedia = new WeakSet<HTMLMediaElement>();

  constructor(
    private onMediaFound: MediaCallback,
    private onMediaRemoved: MediaCallback,
    private includeAudio = false,
  ) {}

  observe(root: Document | ShadowRoot): HTMLMediaElement[] {
    this.attach(root);
    const found = new Set<HTMLMediaElement>();
    this.scan(root, found, true);
    this.reportFound(found);
    return [...found];
  }

  private attach(root: Document | ShadowRoot): void {
    if (this.observers.has(root)) return;
    const observer = new MutationObserver(mutations => {
      this.pendingMutations.push(...mutations);
      if (this.flushTimeoutId !== null) return;
      this.flushTimeoutId = BrowserFeatures.hasRequestIdleCallback
        ? requestIdleCallback(() => this.flush(), { timeout: OBSERVER.IDLE_TIMEOUT_MS })
        : setTimeout(() => this.flush(), OBSERVER.DEBOUNCE_MS);
    });
    observer.observe(root, { childList: true, subtree: true });
    this.observers.set(root, observer);
  }

  private scan(root: Node, media: Set<HTMLMediaElement>, observeShadows: boolean): void {
    for (const element of scanMediaTree(root, this.includeAudio, shadow => {
      if (observeShadows && shadow.host.isConnected) this.attach(shadow);
    })) media.add(element);
  }

  private reportFound(found: Set<HTMLMediaElement>): void {
    for (const media of found) {
      if (media.isConnected && !this.trackedMedia.has(media)) {
        this.trackedMedia.add(media);
        this.onMediaFound(media);
      }
    }
  }

  private flush(): void {
    this.flushTimeoutId = null;
    const mutations = this.pendingMutations;
    this.pendingMutations = [];
    const found = new Set<HTMLMediaElement>();
    const removed = new Set<HTMLMediaElement>();
    for (const mutation of mutations) {
      // attachShadow itself has no mutation record; a later host mutation can reveal it.
      if (mutation.target instanceof Element) {
        const shadow = getShadowRoot(mutation.target);
        if (shadow && !this.observers.has(shadow)) {
          this.attach(shadow);
          this.scan(shadow, found, true);
        }
      }
      for (const node of mutation.removedNodes) this.scan(node, removed, false);
      for (const node of mutation.addedNodes) this.scan(node, found, true);
    }
    for (const media of removed) {
      if (!media.isConnected && this.trackedMedia.has(media)) {
        this.trackedMedia.delete(media);
        this.onMediaRemoved(media);
      }
    }
    for (const [root, observer] of this.observers) {
      if (root instanceof ShadowRoot && !root.host.isConnected) {
        observer.disconnect();
        this.observers.delete(root);
      }
    }
    this.reportFound(found);
  }

  disconnect(): void {
    if (this.flushTimeoutId !== null) {
      if (BrowserFeatures.hasRequestIdleCallback) cancelIdleCallback(this.flushTimeoutId as number);
      else clearTimeout(this.flushTimeoutId as ReturnType<typeof setTimeout>);
    }
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    this.trackedMedia = new WeakSet();
    this.pendingMutations = [];
    this.flushTimeoutId = null;
  }
}
