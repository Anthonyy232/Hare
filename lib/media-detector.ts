import { getShadowRoot } from './shadow-dom';
import { CONTROLLER, OBSERVER } from './constants';

/** Shared traversal for initial discovery, mutation batches, and on-demand rescans. */
export function scanMediaTree(
  root: Node,
  includeAudio: boolean,
  onShadow?: (shadow: ShadowRoot) => void,
): HTMLMediaElement[] {
  const media: HTMLMediaElement[] = [];
  const queue: Array<{ node: Node; depth: number }> = [{ node: root, depth: 0 }];
  while (queue.length) {
    const { node, depth } = queue.pop()!;
    if (node instanceof Element) {
      if (node.localName === CONTROLLER.ELEMENT_TAG) continue;
      if (node instanceof HTMLVideoElement || (includeAudio && node instanceof HTMLAudioElement)) media.push(node);
      const shadow = getShadowRoot(node);
      if (shadow && depth < OBSERVER.MAX_SHADOW_DEPTH) {
        onShadow?.(shadow);
        queue.push({ node: shadow, depth: depth + 1 });
      }
    }
    // Reverse the stack push to preserve document order for the primary media.
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes[i];
      if (child instanceof Element) queue.push({ node: child, depth });
    }
  }
  return media;
}

export function findAllMedia(root: Document | ShadowRoot, includeAudio: boolean): HTMLMediaElement[] {
  return scanMediaTree(root, includeAudio);
}

export function isValidMedia(media: HTMLMediaElement): boolean {
  return media.isConnected;
}
