import { getShadowRoot } from './shadow-dom';

/**
 * Scans the DOM and all Shadow Roots for media elements using a Generator
 * to allow for early exits and memory-efficient traversal.
 */
function* findMediaElements(
  root: Document | ShadowRoot,
  includeAudio: boolean
): Generator<HTMLMediaElement> {
  const selector = includeAudio ? 'video, audio' : 'video';

  const directMedia = root.querySelectorAll(selector);
  for (const media of directMedia) {
    yield media as HTMLMediaElement;
  }

  // TreeWalker provides the most performant way to crawl deep subtrees for shadow hosts.
  const walker = document.createTreeWalker(
    root instanceof Document ? root.body || root.documentElement : root,
    NodeFilter.SHOW_ELEMENT
  );

  while (walker.nextNode()) {
    const element = walker.currentNode as Element;
    const shadow = getShadowRoot(element);
    if (shadow) {
      yield* findMediaElements(shadow, includeAudio);
    }
  }
}

export function findAllMedia(
  root: Document | ShadowRoot,
  includeAudio: boolean
): HTMLMediaElement[] {
  return [...findMediaElements(root, includeAudio)];
}

/**
 * Validates if the media element is still part of the active document.
 * Fine-grained size validation is delegated to site-specific handlers to avoid reflows.
 */
export function isValidMedia(media: HTMLMediaElement): boolean {
  return media.isConnected;
}
