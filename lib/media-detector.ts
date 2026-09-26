import { getShadowRoot } from './shadow-dom';
import { CONTROLLER } from './constants';

/** Shared traversal for initial discovery, mutation batches, and on-demand rescans. */
export function scanMediaTree(
  root: Node,
  includeAudio: boolean,
  onShadow?: (shadow: ShadowRoot) => void,
): HTMLMediaElement[] {
  const media: HTMLMediaElement[] = [];
  const stack: Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node instanceof Element) {
      if (node.localName === CONTROLLER.ELEMENT_TAG) continue;
      if (node instanceof HTMLVideoElement || (includeAudio && node instanceof HTMLAudioElement)) media.push(node);
      const shadow = getShadowRoot(node);
      if (shadow) {
        onShadow?.(shadow);
        stack.push(shadow);
      }
    }
    // Reverse the stack push to preserve document order for the primary media.
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes[i];
      if (child instanceof Element) stack.push(child);
    }
  }
  return media;
}
