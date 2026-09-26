import { test, expect, openVideo, openUI, rate, setSettings, rpc, tabId, launchExtension } from './fixtures/extension';
import { DEFAULT_SETTINGS } from '../../lib/types';

test('large controller buttons remain reachable inside a small player', async ({ extension }, testInfo) => {
  await setSettings(extension.worker, { controllerButtonSize: 24, controllerOpacity: 1 });
  const page = await openVideo(extension.context);
  await page.locator('#player').evaluate(player => {
    (player as HTMLElement).style.width = '320px';
    (player as HTMLElement).style.height = '180px';
    const video = player.querySelector('video')!;
    video.width = 320; video.height = 180;
  });
  await page.locator('.hare-speed').focus();
  await page.screenshot({ path: testInfo.outputPath('small-player.png') });
  const player = (await page.locator('video').boundingBox())!;
  for (const button of await page.locator('.hare-btn').all()) {
    const rect = (await button.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(player.x);
    expect(rect.y).toBeGreaterThanOrEqual(player.y);
    expect(rect.x + rect.width).toBeLessThanOrEqual(player.x + player.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(player.y + player.height);
  }
  await page.getByRole('button', { name: 'Faster', exact: true }).click();
  await expect.poll(() => rate(page)).toBeCloseTo(1.1);
});

test('sync offset controls work in both directions and preserve the selected step when reopened', async ({ extension }) => {
  const a = await openVideo(extension.context, '?offset-a');
  const b = await openVideo(extension.context, '?offset-b');
  await a.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 10; });
  await b.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 15; });
  const popup = await openUI(extension, 'popup', a);
  expect(await rpc(popup, 'START_SYNC', { tabIdA: await tabId(popup, a), tabIdB: await tabId(popup, b) })).toEqual({ success: true });
  const step = popup.getByRole('combobox', { name: 'Nudge step' });
  await step.selectOption('0.5');
  await popup.getByRole('button', { name: 'Shift B later', exact: true }).click();
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(15.5);
  await popup.getByRole('button', { name: 'Shift B earlier', exact: true }).click();
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(15);
  await popup.reload();
  await expect(step).toHaveValue('0.5');
  await popup.evaluate(() => {
    const api = (globalThis as any).chrome.runtime;
    const send = api.sendMessage.bind(api);
    api.sendMessage = (message: any) => {
      if (message.type !== 'SET_NUDGE_STEP') return send(message);
      api.sendMessage = send;
      return Promise.resolve({ success: false, error: 'Could not change the nudge step.' });
    };
  });
  await step.selectOption('0.05');
  await expect(popup.getByRole('alert')).toContainText('Could not change the nudge step.');
  await expect(step).toHaveValue('0.5');
  await popup.evaluate(() => {
    const api = (globalThis as any).chrome.runtime;
    const send = api.sendMessage.bind(api);
    (globalThis as any).restoreSyncStatus = () => { api.sendMessage = send; };
    api.sendMessage = (message: any) => {
      if (message.type !== 'GET_SYNC_STATUS') return send(message);
      (globalThis as any).syncStatusFailed = true;
      return Promise.reject(new Error('Background temporarily unavailable'));
    };
  });
  await expect.poll(() => popup.evaluate(() => (globalThis as any).syncStatusFailed)).toBe(true);
  await expect(popup.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await popup.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Sync Mode', exact: true })).toBeVisible();
  await popup.evaluate(() => (globalThis as any).restoreSyncStatus());
  const stoppedStatus = await rpc(popup, 'GET_SYNC_STATUS');
  expect(stoppedStatus.active).toBe(false);
  await a.bringToFront();
  await a.keyboard.press('d');
  await expect.poll(() => rate(a)).toBeCloseTo(1.1);
  expect(await rate(b)).toBe(1);
});

test('sync recovers buffering after the real extension service worker is terminated', async ({ extension }) => {
  const a = await openVideo(extension.context, '?worker-a');
  const b = await openVideo(extension.context, '?worker-b');
  const popup = await openUI(extension, 'popup', a);
  expect(await rpc(popup, 'START_SYNC', { tabIdA: await tabId(popup, a), tabIdB: await tabId(popup, b) })).toEqual({ success: true });
  await a.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await a.locator('video').evaluate(v => v.dispatchEvent(new Event('waiting')));
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect.poll(() => popup.evaluate(async () => {
    const state = await (globalThis as any).chrome.storage.session.get('syncSession_v2');
    return state.syncSession_v2.session.bufferingTab;
  })).toBe('A');
  const cdp = await extension.context.newCDPSession(a);
  const versions = new Map<string, { versionId: string; scriptURL: string; runningStatus: string }>();
  const stoppedVersions = new Set<string>();
  cdp.on('ServiceWorker.workerVersionUpdated', event => {
    for (const version of event.versions) {
      versions.set(version.versionId, version);
      if (version.runningStatus === 'stopped') stoppedVersions.add(version.versionId);
    }
  });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => [...versions.values()].some(v => v.scriptURL.includes(extension.id) && v.runningStatus === 'running')).toBe(true);
  const version = [...versions.values()].find(v => v.scriptURL.includes(extension.id) && v.runningStatus === 'running')!;
  stoppedVersions.clear();
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  // Chromium can retain the DevTools target while replacing its worker execution context.
  await expect.poll(() => stoppedVersions.has(version.versionId)).toBe(true);
  await a.locator('video').evaluate(v => v.dispatchEvent(new Event('canplay')));
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await a.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await a.bringToFront();
  await a.keyboard.press('d');
  await expect.poll(() => rate(b)).toBeCloseTo(1.1);
  await a.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 20; });
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(20, 1);
  expect((await rpc(popup, 'GET_SYNC_STATUS')).active).toBe(true);
  await cdp.detach();
});

test('browser restart preserves settings and clears the old sync session', async ({ extension }, testInfo) => {
  const a = await openVideo(extension.context, '?restart-a');
  const b = await openVideo(extension.context, '?restart-b');
  const popup = await openUI(extension, 'popup', a);
  expect(await rpc(popup, 'START_SYNC', { tabIdA: await tabId(popup, a), tabIdB: await tabId(popup, b) })).toEqual({ success: true });
  await setSettings(extension.worker, { startHidden: true, enableAudio: true, controllerOpacity: 0.65, blacklist: 'example.com' });
  await extension.context.close();
  const context = await launchExtension(testInfo.outputPath('profile'));
  try {
    const video = await openVideo(context, '?after-restart');
    await expect(video.locator('.hare-speed')).toBeHidden();
    const ui = await openUI({ context, id: extension.id }, 'options');
    expect((await rpc(ui, 'GET_SYNC_STATUS')).active).toBe(false);
    await expect(ui.getByRole('slider', { name: 'Controller opacity' })).toHaveValue('0.65');
    await expect(ui.locator('#blacklist')).toHaveValue('example.com');
    await expect(ui.getByRole('checkbox', { name: /Include audio-only/ })).toBeChecked();
  } finally { await context.close(); }
});

test('settings conflicts preserve numeric drafts and discard reloads the saved values', async ({ extension }) => {
  const first = await openUI(extension, 'options');
  const second = await openUI(extension, 'options');
  const draft = first.getByRole('spinbutton', { name: 'Reset Speed Target speed' });
  await draft.fill('1.75');
  await second.getByRole('slider', { name: 'Controller opacity' }).fill('0.6');
  await second.getByRole('button', { name: 'Save Settings' }).click();
  await expect(second.getByText('Settings saved', { exact: true })).toBeVisible();
  await expect(first.getByRole('alert')).toContainText('Settings were changed in another tab');
  await expect(draft).toHaveValue('1.75');
  await first.getByRole('button', { name: 'Discard local changes' }).click();
  await expect(draft).toHaveValue('1');
  await expect(first.getByRole('slider', { name: 'Controller opacity' })).toHaveValue('0.6');
  await expect(first.getByRole('button', { name: 'Save Settings' })).toBeDisabled();
});

test('settings initial load failure has a working retry and defaults reset can be cancelled', async ({ extension }) => {
  const options = await extension.context.newPage();
  await options.addInitScript(() => {
    const api = (globalThis as any).chrome.storage.sync;
    const original = api.get.bind(api);
    (globalThis as any).restoreStorageGet = () => { api.get = original; };
    api.get = () => Promise.reject(new Error('Injected read failure'));
  });
  await options.goto(`chrome-extension://${extension.id}/options.html`);
  await expect(options.getByRole('alert')).toContainText('Could not load your settings');
  await options.evaluate(() => (globalThis as any).restoreStorageGet());
  await options.getByRole('button', { name: 'Try again' }).click();
  await options.locator('#blacklist').fill('example.com');
  await options.getByRole('button', { name: 'Save Settings' }).click();
  await expect(options.getByText('Settings saved', { exact: true })).toBeVisible();
  options.once('dialog', dialog => dialog.dismiss());
  await options.getByRole('button', { name: 'Reset to Defaults' }).click();
  await expect(options.locator('#blacklist')).toHaveValue('example.com');
  options.once('dialog', dialog => dialog.accept());
  await options.getByRole('button', { name: 'Reset to Defaults' }).click();
  await expect(options.locator('#blacklist')).not.toHaveValue('example.com');
  await expect(options.getByRole('button', { name: 'Save Settings' })).toBeDisabled();
});

test('shortcut capture rejects duplicates and modifiers, clears keys, and supports custom seek steps', async ({ extension }) => {
  const video = await openVideo(extension.context);
  const options = await openUI(extension, 'options');
  const key = options.getByRole('button', { name: 'Change shortcut for Increase Speed', exact: true });
  await key.click();
  await key.press('s');
  await expect(options.getByRole('alert')).toContainText('already assigned');
  await expect(key).toHaveText('D');
  await key.click();
  await key.press('Shift+k');
  await expect(options.getByRole('alert')).toContainText('single key');
  await key.press('Escape');
  await expect(key).toHaveText('D');
  await key.click();
  await key.press('k');
  await options.getByRole('spinbutton', { name: 'Advance Seconds' }).fill('3.25');
  await options.getByRole('spinbutton', { name: 'Advance Seconds' }).press('Enter');
  await options.getByRole('button', { name: 'Save Settings' }).click();
  await expect(options.getByText('Settings saved', { exact: true })).toBeVisible();
  await video.bringToFront();
  await video.keyboard.press('k');
  await expect.poll(() => rate(video)).toBeCloseTo(1.1);
  await video.keyboard.press('x');
  await expect.poll(() => video.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(3.25);
  await options.getByRole('button', { name: 'Clear shortcut for Increase Speed', exact: true }).click();
  await options.getByRole('button', { name: 'Save Settings' }).click();
  await expect(key).toHaveText('Unbound');
  await video.keyboard.press('k');
  expect(await rate(video)).toBeCloseTo(1.1);
});

test('sync candidates recover from missing tabs and setup can be cancelled', async ({ extension }) => {
  const a = await openVideo(extension.context, '?candidate-a');
  const popup = await openUI(extension, 'popup', a);
  await popup.getByRole('button', { name: 'Sync Mode', exact: true }).click();
  await expect(popup.getByRole('alert')).toContainText('at least 2');
  const b = await openVideo(extension.context, '?candidate-b');
  await popup.getByRole('button', { name: 'Refresh tab list' }).click();
  await expect(popup.locator('.candidate')).toHaveCount(2);
  await popup.locator('.candidate').nth(0).click();
  await popup.locator('.candidate').nth(1).click();
  await b.close();
  await popup.getByRole('button', { name: 'Refresh tab list' }).click();
  await expect(popup.locator('.candidate')).toHaveCount(1);
  await expect(popup.getByRole('button', { name: 'Start Sync', exact: true })).toBeDisabled();
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Sync Mode', exact: true })).toBeVisible();
  expect((await rpc(popup, 'GET_SYNC_STATUS')).active).toBe(false);
});

test('real video playback stays controllable in picture-in-picture and after returning', async ({ extension }, testInfo) => {
  const video = await openVideo(extension.context, '?visual');
  expect(await video.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(160);
  await video.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Open picture-in-picture';
    button.onclick = async () => {
      await document.querySelector('video')!.play();
      await document.querySelector('video')!.requestPictureInPicture();
    };
    document.body.append(button);
  });
  await video.getByRole('button', { name: 'Open picture-in-picture' }).click();
  await expect.poll(() => video.evaluate(() => document.pictureInPictureElement?.tagName)).toBe('VIDEO');
  const popup = await openUI(extension, 'popup', video);
  await popup.getByRole('button', { name: 'Set speed to 1.5x', exact: true }).click();
  await expect.poll(() => rate(video)).toBe(1.5);
  await video.evaluate(() => document.exitPictureInPicture());
  await expect(video.locator('hare-controller')).toHaveCount(1);
  await video.bringToFront();
  await video.locator('h1').click();
  await video.keyboard.press('r');
  await expect.poll(() => rate(video)).toBe(1);
  await video.screenshot({ path: testInfo.outputPath('real-video.png') });
});

test('popup rejects invalid speed drafts and can recover on a restricted browser page', async ({ extension }) => {
  const video = await openVideo(extension.context);
  const popup = await openUI(extension, 'popup', video);
  const speed = popup.getByRole('spinbutton', { name: 'Playback speed' });
  await speed.fill('-10');
  await speed.press('Enter');
  await expect.poll(() => rate(video)).toBeCloseTo(0.07);
  await expect(speed).toBeEnabled();
  await speed.fill('99');
  await speed.press('Enter');
  await expect.poll(() => rate(video)).toBe(16);
  await expect(speed).toBeEnabled();
  await video.goto('chrome://version');
  await expect(popup.getByText('Hare cannot run on this browser page', { exact: true })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Exclude this site', exact: true })).toHaveCount(0);
});

test('forced shortcuts override page listeners but never intercept typing or composition', async ({ extension }) => {
  const page = await openVideo(extension.context);
  await page.evaluate(() => {
    (globalThis as any).siteKeys = 0;
    document.addEventListener('keydown', () => { (globalThis as any).siteKeys++; });
  });
  await page.keyboard.press('d');
  await expect.poll(() => rate(page)).toBeCloseTo(1.1);
  expect(await page.evaluate(() => (globalThis as any).siteKeys)).toBe(1);
  await setSettings(extension.worker, { keyBindings: DEFAULT_SETTINGS.keyBindings.map(binding => ({ ...binding, force: true })) });
  // Wait for the storage listener rather than assuming a write synchronously updates content.
  await expect.poll(async () => {
    await page.keyboard.press('r');
    return rate(page);
  }).toBe(1);
  const seen = await page.evaluate(() => (globalThis as any).siteKeys);
  await page.keyboard.press('d');
  await expect.poll(() => rate(page)).toBeCloseTo(1.1);
  expect(await page.evaluate(() => (globalThis as any).siteKeys)).toBe(seen);
  await page.getByRole('textbox', { name: 'Comment' }).fill('d');
  await page.getByRole('textbox', { name: 'Comment' }).press('d');
  await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveValue('dd');
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', isComposing: true, bubbles: true })));
  expect(await rate(page)).toBeCloseTo(1.1);
});

test('oversized settings and failed reset preserve saved data and recover', async ({ extension }) => {
  const options = await openUI(extension, 'options');
  const blacklist = options.locator('#blacklist');
  const longList = Array.from({ length: 500 }, (_, i) => `excluded-${i}.example.com`).join('\n');
  await blacklist.fill(longList);
  await options.getByRole('button', { name: 'Save Settings', exact: true }).click();
  await expect(options.getByRole('alert')).toContainText('too large to sync');
  await expect(blacklist).toHaveValue(longList);
  await blacklist.fill('saved.example.com');
  await options.getByRole('button', { name: 'Save Settings', exact: true }).click();
  await expect(options.getByText('Settings saved', { exact: true })).toBeVisible();
  await options.evaluate(() => {
    const api = (globalThis as any).chrome.storage.sync;
    const original = api.set.bind(api);
    (globalThis as any).restoreStorageSet = () => { api.set = original; };
    api.set = () => Promise.reject(new Error('Injected reset failure'));
  });
  options.once('dialog', dialog => dialog.accept());
  await options.getByRole('button', { name: 'Reset to Defaults', exact: true }).click();
  await expect(options.getByRole('alert')).toContainText('Could not reset settings');
  await expect(blacklist).toHaveValue('saved.example.com');
  await options.evaluate(() => (globalThis as any).restoreStorageSet());
  options.once('dialog', dialog => dialog.accept());
  await options.getByRole('button', { name: 'Reset to Defaults', exact: true }).click();
  await expect(blacklist).toHaveValue(DEFAULT_SETTINGS.blacklist);
  await options.reload();
  await expect(blacklist).toHaveValue(DEFAULT_SETTINGS.blacklist);
});

test('popup reports site rate limiting', async ({ extension }) => {
  const page = await openVideo(extension.context);
  const popup = await openUI(extension, 'popup', page);
  await popup.getByRole('button', { name: 'Set speed to 1.5x', exact: true }).click();
  await expect.poll(() => rate(page)).toBe(1.5);
  await page.locator('video').first().evaluate((video: HTMLVideoElement) => {
    window.addEventListener('ratechange', event => {
      if (event.target === video && video.playbackRate > 1.5) video.playbackRate = 1.5;
    }, { capture: true });
  });
  await popup.getByRole('button', { name: 'Set speed to 2x', exact: true }).click();
  await expect(popup.getByText('This player limited or blocked the requested speed.', { exact: true })).toBeVisible();
  await expect.poll(() => rate(page)).toBe(1.5);
});

test('buffering signals pause the partner and recovery never overrides a deliberate pause', async ({ extension }) => {
  const a = await openVideo(extension.context, '?buffer-a');
  const b = await openVideo(extension.context, '?buffer-b');
  const popup = await openUI(extension, 'popup', a);
  expect(await rpc(popup, 'START_SYNC', { tabIdA: await tabId(popup, a), tabIdB: await tabId(popup, b) })).toEqual({ success: true });
  await a.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  // Deterministic media-event fault injection; does not claim a real network stall.
  await a.locator('video').evaluate(v => v.dispatchEvent(new Event('waiting')));
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await a.locator('video').evaluate(v => v.dispatchEvent(new Event('playing')));
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await a.locator('video').evaluate(v => v.dispatchEvent(new Event('waiting')));
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await a.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
  await a.locator('video').evaluate(v => v.dispatchEvent(new Event('playing')));
  await a.waitForTimeout(200); // Longer than the 50ms buffering recovery timer.
  expect(await a.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  expect(await b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

test('a stale stop from an unrelated content frame cannot end the active pair', async ({ extension }) => {
  const a = await openVideo(extension.context, '?pair-a');
  const b = await openVideo(extension.context, '?pair-b');
  const unrelated = await openVideo(extension.context, '?unrelated');
  const popup = await openUI(extension, 'popup', a);
  expect(await rpc(popup, 'START_SYNC', { tabIdA: await tabId(popup, a), tabIdB: await tabId(popup, b) })).toEqual({ success: true });
  const cdp = await extension.context.newCDPSession(unrelated);
  let contentContext: number | undefined;
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    if (context.origin === `chrome-extension://${extension.id}`) contentContext = context.id;
  });
  await cdp.send('Runtime.enable');
  await expect.poll(() => contentContext).toBeDefined();
  const result = await cdp.send('Runtime.evaluate', { contextId: contentContext, expression: "chrome.runtime.sendMessage({type:'STOP_SYNC'})", awaitPromise: true, returnByValue: true });
  expect(result.result.value).toEqual({ success: true });
  expect((await rpc(popup, 'GET_SYNC_STATUS')).active).toBe(true);
  await a.keyboard.press('d');
  await expect.poll(() => rate(b)).toBeCloseTo(1.1);
  await cdp.detach();
});

test('periodic drift correction repairs a displaced playing follower', async ({ extension }) => {
  const a = await openVideo(extension.context, '?drift-a');
  const b = await openVideo(extension.context, '?drift-b');
  await a.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 20; });
  await b.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 20; });
  const popup = await openUI(extension, 'popup', a);
  const tabIdB = await tabId(popup, b);
  expect(await rpc(popup, 'START_SYNC', { tabIdA: await tabId(popup, a), tabIdB })).toEqual({ success: true });
  await a.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  // Displace B through the agent's no-echo command so the coordinator must detect drift.
  await popup.evaluate(async tabId => {
    await (globalThis as any).chrome.tabs.sendMessage(tabId, { type: 'SYNC_DRIFT_CORRECT', payload: { method: 'seek', position: 15 } }, { frameId: 0 });
  }, tabIdB);
  await expect.poll(async () => {
    const [left, right] = await Promise.all([a, b].map(page => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)));
    return Math.abs(left - right);
  }, { timeout: 7000 }).toBeLessThan(0.2);
  expect((await rpc(popup, 'GET_SYNC_STATUS')).active).toBe(true);
});

test('keyboard playback control survives browser-native video fullscreen', async ({ extension }) => {
  const page = await openVideo(extension.context, '?visual');
  await page.locator('video').evaluate(v => v.requestFullscreen());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('VIDEO');
  await page.keyboard.press('d');
  await expect.poll(() => rate(page)).toBeCloseTo(1.1);
  await page.evaluate(() => document.exitFullscreen());
  await page.locator('.hare-speed').focus();
  await expect(page.getByRole('button', { name: 'Faster', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Faster', exact: true }).click();
  await expect.poll(() => rate(page)).toBeCloseTo(1.2);
});

test('native buffer starvation recovers while paused and fatal media errors end sync', async ({ extension }) => {
  const a = await openVideo(extension.context, '?mse-starvation');
  const b = await openVideo(extension.context, '?mse-peer');
  await a.locator('video').evaluate(async (video: HTMLVideoElement) => {
    const source = new MediaSource();
    video.src = URL.createObjectURL(source);
    await new Promise(resolve => source.addEventListener('sourceopen', resolve, { once: true }));
    const buffer = source.addSourceBuffer('video/webm; codecs="vp8"');
    const data = await (await fetch('/motion.webm')).arrayBuffer();
    const append = () => new Promise(resolve => {
      buffer.addEventListener('updateend', resolve, { once: true });
      buffer.appendBuffer(data);
    });
    await append();
    video.currentTime = 11.5;
    (window as any).refill = async () => { buffer.timestampOffset = 12; await append(); };
    (window as any).failMedia = () => source.endOfStream('decode');
  });
  await expect.poll(() => a.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(3);
  const popup = await openUI(extension, 'popup', a);
  const aId = await tabId(popup, a);
  expect(await rpc(popup, 'START_SYNC', { tabIdA: aId, tabIdB: await tabId(popup, b) })).toEqual({ success: true });
  await a.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => a.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeLessThan(3);
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  // A second stall pauses the first source too; paused media recovers with canplay, not playing.
  await popup.evaluate(async tab => (globalThis as any).chrome.tabs.sendMessage(tab, {
    type: 'SYNC_PAUSE', payload: { action: 'pause', position: -1, timestamp: Date.now(), generation: 1, buffering: true },
  }, { frameId: 0 }), aId);
  await expect.poll(() => a.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await a.evaluate(() => (window as any).refill());
  await expect.poll(() => a.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(12.05);
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await a.evaluate(() => (window as any).failMedia());
  await expect.poll(() => a.locator('video').evaluate((v: HTMLVideoElement) => v.error?.code)).toBe(3);
  await expect.poll(async () => (await rpc(popup, 'GET_SYNC_STATUS')).active).toBe(false);
});
