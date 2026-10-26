import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mpv } from './mpv';

let state: { file: string; time: number; paused: boolean; buffering: boolean; speed: number; title: string };
let eventReplies: Array<{ file: string | null; seq: number; events: unknown[] }>;

const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
  if (new URL(url).pathname !== '/events') return Response.json(state);
  const reply = eventReplies.shift();
  if (reply) return Response.json(reply);
  // Like mpv, hold the request until there is news or the sync stops.
  return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))));
});

const sentChanges = () => fetchMock.mock.calls
  .map(([url]) => new URL(url))
  .filter(url => url.pathname === '/set')
  .map(url => Object.fromEntries(url.searchParams));

describe('mpv client', () => {
  beforeEach(async () => {
    state = { file: 'f1', time: 10, paused: true, buffering: false, speed: 1, title: 'Movie' };
    eventReplies = [];
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await mpv.handle({ type: 'SYNC_DEACTIVATE' });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('forwards mpv events, skipping those from before the sync', async () => {
    const onEvent = vi.fn();
    mpv.onEvent = onEvent;
    eventReplies = [
      { file: 'f1', seq: 5, events: [{ action: 'seek', position: 1, rate: 1 }] },
      { file: 'f1', seq: 6, events: [{ action: 'pause', position: 12, rate: 1 }] },
    ];
    await mpv.handle({ type: 'SYNC_ACTIVATE' });
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce());
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'pause', position: 12 }));
  });

  it('ends the sync when mpv opens another file', async () => {
    const onFileChanged = vi.fn();
    mpv.onFileChanged = onFileChanged;
    await mpv.handle({ type: 'SYNC_ACTIVATE' });
    state.file = 'f2';
    await expect(mpv.handle({ type: 'SYNC_GET_POSITION' })).rejects.toThrow('another file');
    expect(onFileChanged).toHaveBeenCalledOnce();
  });

  it('starts playing where the tab will be once the command arrives', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    await mpv.handle({ type: 'SYNC_ACTIVATE' });
    await mpv.handle({ type: 'SYNC_PLAY', payload: { action: 'play', position: 20, rate: 2, timestamp: 9_500, generation: 1 } });
    expect(sentChanges()).toEqual([{ pause: '0', seek: '21' }]);
  });

  it('restores the base speed after a drift correction', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await mpv.handle({ type: 'SYNC_ACTIVATE' });
    await mpv.handle({ type: 'SYNC_DRIFT_CORRECT', payload: { method: 'rate', rateFactor: 0.02, durationMs: 3000 } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(sentChanges()).toEqual([{ speed: '1.02' }, { speed: '1' }]);
  });
});
