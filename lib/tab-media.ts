import { browser } from 'wxt/browser';
import type { HareMessage, StatusResponse } from './types';
import { withTimeout } from './async-utils';

export async function getFrameIds(tabId: number): Promise<number[]> {
  try {
    const frames = await withTimeout(browser.webNavigation.getAllFrames({ tabId }));
    return frames?.length ? frames.map(frame => frame.frameId) : [0];
  } catch { return [0]; }
}

export async function sendToFrame(tabId: number, frameId: number, message: HareMessage): Promise<unknown> {
  return withTimeout(browser.tabs.sendMessage(tabId, message, { frameId }));
}

export function isStatusResponse(value: unknown): value is StatusResponse {
  if (!value || typeof value !== 'object') return false;
  const status = value as StatusResponse;
  return typeof status.hasVideos === 'boolean' && Number.isInteger(status.videoCount) && status.videoCount >= 0
    && Number.isFinite(status.currentSpeed) && status.currentSpeed > 0;
}

export async function getTabMedia(tabId: number): Promise<Array<{ frameId: number; status: StatusResponse }>> {
  const frames = await getFrameIds(tabId);
  const statuses = await Promise.all(frames.map(async frameId => {
    try {
      const status = await sendToFrame(tabId, frameId, { type: 'GET_STATUS' });
      return isStatusResponse(status) ? { frameId, status } : null;
    } catch { return null; }
  }));
  return statuses.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export function aggregateStatus(statuses: StatusResponse[]): StatusResponse {
  const media = statuses.filter(status => status.videoCount > 0);
  const speed = media[0]?.currentSpeed ?? 1;
  return {
    hasVideos: media.length > 0,
    videoCount: media.reduce((sum, status) => sum + status.videoCount, 0),
    currentSpeed: speed,
    mixedSpeeds: media.some(status => status.mixedSpeeds || Math.abs(status.currentSpeed - speed) > 0.001),
  };
}
