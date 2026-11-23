import { browser } from 'wxt/browser';
import type { HareMessage, Reply } from './messages';

/** The reply to a request whose handler threw. */
export function failureReply(error: unknown) {
  return { success: false, error: error instanceof Error ? error.message : String(error) } as const;
}

export async function withTimeout<T>(request: Promise<T>, timeoutMs = 2500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The tab did not respond. Reload it and try again.')), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export function sendToTab<M extends HareMessage>(tabId: number, message: M, frameId?: number): Promise<Reply<M>> {
  const request = frameId == null
    ? browser.tabs.sendMessage(tabId, message)
    : browser.tabs.sendMessage(tabId, message, { frameId });
  return withTimeout(request as Promise<Reply<M>>);
}

// After an extension update, sendMessage throws synchronously in old content scripts; async turns that into a rejection.
export async function sendToBackground<M extends HareMessage>(message: M): Promise<Reply<M>> {
  return browser.runtime.sendMessage(message);
}

export async function getFrameIds(tabId: number): Promise<number[]> {
  try {
    const frames = await withTimeout(browser.webNavigation.getAllFrames({ tabId }));
    return frames?.length ? frames.map(frame => frame.frameId) : [0];
  } catch { return [0]; }
}

/** Sends to every frame of a tab; frames without Hare, or that fail to answer, are left out. */
export async function askEveryFrame<M extends HareMessage>(tabId: number, message: M): Promise<Array<{ frameId: number; reply: Reply<M> }>> {
  const replies = await Promise.all((await getFrameIds(tabId)).map(frameId =>
    sendToTab(tabId, message, frameId).then(reply => ({ frameId, reply }), () => null)));
  return replies.filter(reply => reply !== null);
}

/** Sets the speed of all media in a tab. False when there is none, or some could not be set. */
export async function setTabSpeed(tabId: number, speed: number): Promise<boolean> {
  const frames = (await getTabMedia(tabId)).filter(frame => frame.speeds.length > 0);
  const results = await Promise.allSettled(frames.map(frame => sendToTab(tabId, { type: 'SET_SPEED', payload: speed }, frame.frameId)));
  return results.length > 0 && results.every(result => result.status === 'fulfilled' && result.value.success);
}

export async function getTabMedia(tabId: number): Promise<Array<{ frameId: number; speeds: number[] }>> {
  return (await askEveryFrame(tabId, { type: 'GET_STATUS' })).map(({ frameId, reply }) => ({ frameId, speeds: reply.speeds ?? [] }));
}
