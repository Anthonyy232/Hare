import { getShadowRoot, scanMediaTree } from './detector';

const IDLE_TIMEOUT_MS = 100;

export class ObserverPool {
  private observers = new Map<Document | ShadowRoot, MutationObserver>();
  private pendingMutations: MutationRecord[] = [];
  private flushId: number | null = null;

  /** Media may be reported again; after `onNodesRemoved` some of it may be gone. */
  constructor(
    private onMediaFound: (media: HTMLMediaElement) => void,
    private onNodesRemoved: () => void,
    private includeAudio = false,
  ) {}

  scan(): void {
    this.attach(document);
    this.report(document);
  }

  private attach(root: Document | ShadowRoot): void {
    if (this.observers.has(root)) return;
    const observer = new MutationObserver(mutations => {
      this.pendingMutations.push(...mutations);
      if (this.flushId !== null) return;
      this.flushId = requestIdleCallback(() => this.flush(), { timeout: IDLE_TIMEOUT_MS });
    });
    observer.observe(root, { childList: true, subtree: true });
    this.observers.set(root, observer);
  }

  private report(root: Node): void {
    for (const media of scanMediaTree(root, this.includeAudio, shadow => {
      if (shadow.host.isConnected) this.attach(shadow);
    })) {
      if (media.isConnected) this.onMediaFound(media);
    }
  }

  private flush(): void {
    this.flushId = null;
    const mutations = this.pendingMutations;
    this.pendingMutations = [];
    if (mutations.some(mutation => mutation.removedNodes.length)) {
      this.onNodesRemoved();
      for (const [root, observer] of this.observers) {
        if (root instanceof ShadowRoot && !root.host.isConnected) {
          observer.disconnect();
          this.observers.delete(root);
        }
      }
    }
    for (const mutation of mutations) {
      // attachShadow itself has no mutation record; a later host mutation can reveal it.
      if (mutation.target instanceof Element) {
        const shadow = getShadowRoot(mutation.target);
        if (shadow && !this.observers.has(shadow)) {
          this.attach(shadow);
          this.report(shadow);
        }
      }
      for (const node of mutation.addedNodes) this.report(node);
    }
  }

  disconnect(): void {
    if (this.flushId !== null) cancelIdleCallback(this.flushId);
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    this.pendingMutations = [];
    this.flushId = null;
  }
}
