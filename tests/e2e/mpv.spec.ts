import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { test, expect, openVideo, openUI, rpc, tabId } from './fixtures/extension';

const mpvInstalled = spawnSync('mpv', ['--version']).status === 0;
const pipe = process.platform === 'win32' ? '\\\\.\\pipe\\hare-e2e-mpv' : '/tmp/hare-e2e-mpv.sock';

async function mpvState(): Promise<{ time: number; paused: boolean; speed: number } | null> {
  try {
    const response = await fetch('http://127.0.0.1:42730/state', { headers: { 'X-Hare': '1' } });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

/** Sends a command the way a user's key press would, bypassing Hare. */
function mpvCommand(...command: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipe, () => socket.end(JSON.stringify({ command }) + '\n', resolve));
    socket.on('error', reject);
  });
}

test.describe('mpv', () => {
  test.skip(!mpvInstalled, 'mpv is not installed');
  let player: ChildProcess;

  test.beforeEach(async () => {
    expect(await mpvState(), 'another mpv is already using the Hare port').toBeNull();
    player = spawn('mpv', [
      '--no-config', '--script=public/hare.lua', '--vo=null', '--ao=null', '--pause',
      `--input-ipc-server=${pipe}`, 'av://lavfi:testsrc=duration=600:rate=30',
    ], { stdio: 'ignore' });
    await expect.poll(mpvState).not.toBeNull();
  });

  test.afterEach(() => {
    // On Windows 'mpv' is a console wrapper around mpv.exe, so end the whole tree.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(player.pid), '/t', '/f']);
    else player.kill();
  });

  test('syncs a tab with mpv both ways and ends when mpv changes files', async ({ extension }) => {
    test.setTimeout(60_000);
    const page = await openVideo(extension.context, '?a');
    const video = page.locator('video');
    await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 10; });
    await mpvCommand('seek', 20, 'absolute+exact');
    await expect.poll(async () => (await mpvState())?.time).toBeCloseTo(20, 1);
    const popup = await openUI(extension, 'popup', page);
    expect(await rpc(popup, 'GET_SYNC_CANDIDATES')).toContainEqual(expect.objectContaining({ tabId: -1, domain: 'mpv' }));
    expect(await rpc(popup, 'START_SYNC', { tabIdA: await tabId(popup, page), tabIdB: -1 })).toEqual({ success: true });
    expect((await rpc(popup, 'GET_SYNC_STATUS')).offset).toBeCloseTo(10, 1);
    await video.evaluate((v: HTMLVideoElement) => v.play());
    await expect.poll(async () => (await mpvState())?.paused).toBe(false);
    // Drift correction closes the gap left by the browser's slower audio start.
    await expect.poll(async () => {
      const [tabTime, state] = await Promise.all([video.evaluate((v: HTMLVideoElement) => v.currentTime), mpvState()]);
      return Math.abs(tabTime + 10 - state!.time);
    }, { timeout: 15_000 }).toBeLessThan(0.08);

    await mpvCommand('set', 'pause', 'yes');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await mpvCommand('seek', 50, 'absolute+exact');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(40, 1);
    await mpvCommand('set', 'speed', '1.5');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);
    await page.keyboard.press('d');
    await expect.poll(async () => (await mpvState())?.speed).toBeCloseTo(1.6);

    await mpvCommand('loadfile', 'av://lavfi:testsrc=duration=60:rate=30');
    await expect.poll(async () => (await rpc(popup, 'GET_SYNC_STATUS')).active).toBe(false);
  });
});
