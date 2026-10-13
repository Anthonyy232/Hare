import { browser } from 'wxt/browser';
import { withTimeout } from './async-utils';
import type { HareMessage, Reply } from './types';

export function sendToTab<M extends HareMessage>(tabId: number, message: M, frameId?: number, timeoutMs?: number): Promise<Reply<M>> {
  const request = frameId == null
    ? browser.tabs.sendMessage(tabId, message)
    : browser.tabs.sendMessage(tabId, message, { frameId });
  return withTimeout(request as Promise<Reply<M>>, timeoutMs);
}

export function sendToBackground<M extends HareMessage>(message: M): Promise<Reply<M>> {
  return browser.runtime.sendMessage(message);
}

export async function getFrameIds(tabId: number): Promise<number[]> {
  try {
    const frames = await withTimeout(browser.webNavigation.getAllFrames({ tabId }));
    return frames?.length ? frames.map(frame => frame.frameId) : [0];
  } catch { return [0]; }
}

/** Speeds of the controlled players in each frame of a tab. Frames without Hare are skipped. */
export async function getTabMedia(tabId: number): Promise<Array<{ frameId: number; speeds: number[] }>> {
  const frames = await Promise.all((await getFrameIds(tabId)).map(frameId =>
    sendToTab(tabId, { type: 'GET_STATUS' }, frameId).then(reply => ({ frameId, speeds: reply.speeds ?? [] }), () => null)));
  return frames.filter(frame => frame !== null);
}

export interface MediaSummary {
  videoCount: number;
  currentSpeed: number;
  mixedSpeeds: boolean;
}

export function summarize(speeds: number[]): MediaSummary {
  const currentSpeed = speeds[0] ?? 1;
  return {
    videoCount: speeds.length,
    currentSpeed,
    mixedSpeeds: speeds.some(speed => Math.abs(speed - currentSpeed) > 0.001),
  };
}
