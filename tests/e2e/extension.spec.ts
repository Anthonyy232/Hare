import { test as base, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '../../lib/types';

const fixture = 'http://127.0.0.1:41739/video.html';
const test = base.extend<{ extension: { context: BrowserContext; worker: Worker; id: string } }>({
  extension: async ({}, use, testInfo) => {
    const extensionPath = path.resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
      channel: 'chromium', headless: true,
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const id = new URL(worker.url()).hostname;
      await worker.evaluate(async settings => {
        await (globalThis as any).chrome.storage.sync.set({ 'hare-settings': settings });
      }, DEFAULT_SETTINGS);
      await use({ context, worker, id });
    } finally { await context.close(); }
  },
});

async function openVideo(context: BrowserContext, query = '') {
  const page = await context.newPage();
  await page.goto(fixture + query);
  if (!query.includes('empty') && !query.includes('frame')) {
    await expect(page.locator('hare-controller')).toHaveCount(1);
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  }
  return page;
}
async function openUI(extension: { context: BrowserContext; id: string }, filename: string, active?: Page) {
  const page = await extension.context.newPage();
  if (active) await active.bringToFront();
  await page.goto(`chrome-extension://${extension.id}/${filename}.html`);
  return page;
}
async function rate(page: Page) { return page.locator('video').first().evaluate((video: HTMLVideoElement) => video.playbackRate); }
async function setSettings(worker: Worker, patch: Partial<Settings>) {
  await worker.evaluate(async patch => {
    const api = (globalThis as any).chrome;
    const stored = await api.storage.sync.get('hare-settings');
    await api.storage.sync.set({ 'hare-settings': { ...stored['hare-settings'], ...patch } });
  }, patch);
}
async function rpc(page: Page, type: string, payload?: unknown): Promise<any> {
  return page.evaluate(({ type, payload }) => (globalThis as any).chrome.runtime.sendMessage({ type, payload }), { type, payload });
}
async function tabId(page: Page, target: Page): Promise<number> {
  return page.evaluate(async url => {
    const tabs = await (globalThis as any).chrome.tabs.query({});
    return tabs.find((tab: any) => tab.url === url).id;
  }, target.url());
}

test('keyboard speed, seeking boundaries, reset, and deliberate pause', async ({ extension }) => {
  const page = await openVideo(extension.context);
  await page.keyboard.press('d');
  await expect.poll(() => rate(page)).toBeCloseTo(1.1);
  await page.keyboard.press('s');
  await expect.poll(() => rate(page)).toBeCloseTo(1);
  await page.locator('video').evaluate((video: HTMLVideoElement) => { video.currentTime = 5; });
  await page.keyboard.press('z');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(0);
  await page.keyboard.press('x');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(10);
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  await page.keyboard.press('d');
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
  await page.waitForTimeout(400); // Regression: the old controller resumed after 50 ms.
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.keyboard.press('r');
  await expect.poll(() => rate(page)).toBe(1);
});

test('shortcuts leave inputs, rich text, shadow inputs, and modified keys alone', async ({ extension }) => {
  const page = await openVideo(extension.context);
  await page.getByRole('textbox', { name: 'Comment' }).fill('');
  await page.keyboard.type('dsrxzv');
  await page.locator('[contenteditable] span').click();
  await page.keyboard.type('dsrxzv');
  await page.evaluate(() => {
    const root = document.querySelector('#shadow-host')!.shadowRoot!;
    root.innerHTML = '<input aria-label="Shadow comment">';
    root.querySelector('input')!.focus();
  });
  await page.keyboard.type('dsrxzv');
  await page.locator('h1').click();
  await page.keyboard.press('Shift+d');
  expect(await rate(page)).toBe(1);
  await expect(page.locator('.hare-speed')).toBeVisible();
});

test('discovers and cleans up media in pre-existing nested shadow trees', async ({ extension }) => {
  const page = await openVideo(extension.context, '?empty');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const host = document.querySelector('#shadow-host')!.shadowRoot!.querySelector('#nested-host')!;
    host.attachShadow({ mode: 'open' }).innerHTML = '<div><video controls src="/media.wav"></video></div>';
    // The outer observed root receives a mutation, which discovers the nested root.
    host.append(document.createElement('span'));
  });
  await expect(page.locator('hare-controller')).toHaveCount(1);
  await page.keyboard.press('d');
  await expect.poll(() => rate(page)).toBeCloseTo(1.1);
  await page.evaluate(() => document.querySelector('#shadow-host')!.remove());
  await expect(page.locator('hare-controller')).toHaveCount(0);
});

test('audio changes and enable/disable apply live without duplicate controllers', async ({ extension }) => {
  const page = await openVideo(extension.context);
  await page.evaluate(() => {
    const container = document.createElement('div');
    container.innerHTML = '<audio controls src="/media.wav"></audio>';
    document.body.append(container);
  });
  await setSettings(extension.worker, { enableAudio: true });
  await expect(page.locator('hare-controller')).toHaveCount(2);
  await setSettings(extension.worker, { enableAudio: false });
  await expect(page.locator('hare-controller')).toHaveCount(1);
  for (let i = 0; i < 2; i++) {
    await setSettings(extension.worker, { enabled: false });
    await expect(page.locator('hare-controller')).toHaveCount(0);
    await setSettings(extension.worker, { enabled: true });
    await expect(page.locator('hare-controller')).toHaveCount(1);
  }
  await page.keyboard.press('d');
  await expect.poll(() => rate(page)).toBeCloseTo(1.1);
});

test('iframe media is controllable and inherits the parent site exclusion', async ({ extension }) => {
  const page = await openVideo(extension.context, '?frame');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('hare-controller')).toHaveCount(1);
  await page.locator('h1').click();
  await page.keyboard.press('d');
  await expect(frame.locator('.hare-speed')).toHaveText('1.10x');
  const popup = await openUI(extension, 'popup', page);
  await expect(popup.locator('.speed-display')).toContainText('1.10');
  await setSettings(extension.worker, { blacklist: '127.0.0.1' });
  await expect(frame.locator('hare-controller')).toHaveCount(0);
  await expect(popup.getByText('This site is excluded', { exact: true })).toBeVisible();
});

test('controller buttons expand on keyboard focus and hidden display can be restored', async ({ extension }) => {
  const page = await openVideo(extension.context);
  await page.locator('.hare-speed').focus();
  await expect(page.getByRole('button', { name: 'Faster', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide controller', exact: true }).click();
  await expect(page.locator('.hare-speed')).toBeHidden();
  const popup = await openUI(extension, 'popup', page);
  await popup.getByRole('button', { name: 'Show / hide controller' }).click();
  await expect(page.locator('.hare-speed')).toBeVisible();
});

test('popup commits complete decimal input and reflects actual media speed', async ({ extension }, testInfo) => {
  const page = await openVideo(extension.context);
  const popup = await openUI(extension, 'popup', page);
  const input = popup.getByRole('spinbutton', { name: 'Playback speed' });
  await expect(input).toHaveValue('1.00');
  await input.fill('1.75');
  expect(await rate(page)).toBe(1);
  await input.press('Enter');
  await expect.poll(() => rate(page)).toBe(1.75);
  await expect(input).toHaveValue('1.75');
  await input.fill('');
  await popup.locator('h1').click();
  expect(await rate(page)).toBe(1.75);
  await expect(input).toHaveValue('1.75');
  await popup.getByRole('button', { name: 'Reset speed to 1.0x' }).click();
  await expect.poll(() => rate(page)).toBe(1);
  await popup.locator('.popup').screenshot({ path: testInfo.outputPath('popup.png') });
  const results = await new AxeBuilder({ page: popup }).analyze();
  expect(results.violations).toEqual([]);
});

test('popup distinguishes empty, disabled, and excluded states', async ({ extension }) => {
  const page = await openVideo(extension.context, '?empty');
  const popup = await openUI(extension, 'popup', page);
  await expect(popup.getByText('No media detected', { exact: true })).toBeVisible();
  await setSettings(extension.worker, { enabled: false });
  await expect(popup.getByText('Hare is turned off', { exact: true })).toBeVisible();
  await setSettings(extension.worker, { enabled: true, blacklist: '127.0.0.1' });
  await expect(popup.getByText('This site is excluded', { exact: true })).toBeVisible();
});

test('speed presets reflect actual rates and take precedence over an unfinished custom value', async ({ extension }) => {
  const video = await openVideo(extension.context);
  const popup = await openUI(extension, 'popup', video);
  await expect(popup.getByText('127.0.0.1', { exact: true })).toBeVisible();
  const preset = popup.getByRole('button', { name: 'Set speed to 1.5x', exact: true });
  await popup.getByRole('spinbutton', { name: 'Playback speed' }).fill('1.75');
  await preset.click();
  await expect.poll(() => rate(video)).toBe(1.5);
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
  await expect(popup.getByRole('spinbutton', { name: 'Playback speed' })).toHaveValue('1.50');
  const slower = popup.getByRole('button', { name: 'Set speed to 0.75x', exact: true });
  await slower.focus();
  await slower.press('Space');
  await expect.poll(() => rate(video)).toBe(0.75);
  // Reset releases Hare's intentional non-default rate enforcement.
  await popup.getByRole('button', { name: 'Set speed to 1x', exact: true }).click();
  await expect.poll(() => rate(video)).toBe(1);
  await video.locator('video').evaluate((v: HTMLVideoElement) => { v.playbackRate = 1.35; });
  await expect(popup.locator('.preset[aria-pressed="true"]')).toHaveCount(0);
  await video.evaluate(() => {
    const container = document.createElement('div');
    container.innerHTML = '<video width="320" height="180" src="/media.wav"></video>';
    document.body.append(container);
    document.querySelector('video')!.playbackRate = 1.5;
  });
  await expect(popup.getByText(/Media have different speeds/)).toBeVisible();
  await expect(popup.locator('.preset[aria-pressed="true"]')).toHaveCount(0);
  await preset.click();
  await expect.poll(() => video.locator('video').evaluateAll(videos => videos.map(v => (v as HTMLVideoElement).playbackRate))).toEqual([1.5, 1.5]);
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
});

test('appearance preview follows drafts and shortcut controls fit narrow settings windows', async ({ extension }, testInfo) => {
  const video = await openVideo(extension.context);
  const options = await openUI(extension, 'options');
  const opacity = options.getByRole('slider', { name: 'Controller opacity' });
  await opacity.fill('0.6');
  await options.getByRole('slider', { name: 'Button size' }).fill('20');
  const preview = options.locator('.preview-overlay .hare-controller');
  await expect(preview).toHaveCSS('opacity', '0.6');
  await expect(preview).toHaveCSS('font-size', '20px');
  await expect(video.locator('.hare-controller')).toHaveCSS('font-size', '14px');
  await options.getByRole('button', { name: 'Expanded', exact: true }).click();
  await expect(preview).toHaveCSS('opacity', '1');
  await expect(options.locator('.preview-overlay .hare-controls')).toBeVisible();
  await options.screenshot({ path: testInfo.outputPath('settings-desktop.png'), fullPage: true });
  await options.getByRole('button', { name: 'Save Settings' }).click();
  await expect(video.locator('.hare-controller')).toHaveCSS('font-size', '20px');
  await options.setViewportSize({ width: 390, height: 844 });
  const override = options.getByRole('checkbox', { name: 'Override site shortcut for Reset Speed', exact: true });
  await override.check();
  await expect(override).toBeChecked();
  await expect.poll(() => options.locator('.shortcut-row').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth))).toBe(true);
  await expect.poll(() => options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await options.locator('.keybind-editor').screenshot({ path: testInfo.outputPath('shortcuts-mobile.png') });
  const results = await new AxeBuilder({ page: options }).analyze();
  expect(results.violations).toEqual([]);
  await options.setViewportSize({ width: 320, height: 720 });
  const shortcut = options.getByRole('button', { name: 'Change shortcut for Decrease Speed', exact: true });
  await shortcut.click();
  await expect(shortcut).toHaveText('Press a key…');
  await expect.poll(() => options.locator('.shortcut-row').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth))).toBe(true);
  await expect.poll(() => options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shortcut.press('k');
  await expect(shortcut).toHaveText('K');
  await shortcut.click();
  await options.getByRole('spinbutton', { name: 'Decrease Speed Speed step' }).click();
  await expect(shortcut).toHaveAttribute('aria-pressed', 'false');
});

test('sync selection preserves a pair, permits swapping roles, and explains deselection', async ({ extension }, testInfo) => {
  const a = await openVideo(extension.context, '?a');
  await openVideo(extension.context, '?b');
  await openVideo(extension.context, '?c');
  const popup = await openUI(extension, 'popup', a);
  await popup.getByRole('button', { name: 'Sync Mode', exact: true }).click();
  const candidates = popup.locator('.candidate');
  await expect(candidates).toHaveCount(3);
  await candidates.nth(0).click();
  await candidates.nth(1).click();
  await expect(candidates.nth(2)).toBeDisabled();
  await expect(popup.getByText('Deselect a tab to choose a different pair.')).toBeVisible();
  await expect(candidates.nth(0).locator('.selection-marker')).toHaveText('A');
  await popup.getByRole('button', { name: 'Swap A / B' }).click();
  await expect(candidates.nth(0).locator('.selection-marker')).toHaveText('B');
  await expect(candidates.nth(1).locator('.selection-marker')).toHaveText('A');
  await candidates.nth(0).click();
  await expect(candidates.nth(2)).toBeEnabled();
  await candidates.nth(2).click();
  await expect.poll(() => popup.locator('.popup').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
  await popup.locator('.popup').screenshot({ path: testInfo.outputPath('sync-setup.png') });
  const results = await new AxeBuilder({ page: popup }).analyze();
  expect(results.violations).toEqual([]);
  await popup.getByRole('button', { name: 'Start Sync', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
});

test('settings save and reload preserve decimal shortcut values and invalid patterns are explained', async ({ extension }, testInfo) => {
  const page = await openUI(extension, 'options');
  const save = page.getByRole('button', { name: 'Save Settings' });
  await expect(save).toBeDisabled();
  await page.getByRole('spinbutton', { name: 'Reset Speed Target speed' }).fill('1.5');
  await page.locator('h1').click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Settings saved' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('spinbutton', { name: 'Reset Speed Target speed' })).toHaveValue('1.5');
  await page.locator('#blacklist').fill('/[/');
  await expect(page.getByText(/Line 1: enter a valid/)).toBeVisible();
  await expect(save).toBeDisabled();
  await page.locator('#blacklist').fill('https://example.com/watch');
  await save.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-mobile.png'), fullPage: true });
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('settings save failure keeps the draft editable and retry succeeds', async ({ extension }) => {
  const page = await openUI(extension, 'options');
  await page.locator('#blacklist').fill('example.com');
  await page.evaluate(() => {
    const api = (globalThis as any).chrome.storage.sync;
    const original = api.set.bind(api);
    api.set = () => { api.set = original; return Promise.reject(new Error('Storage temporarily unavailable')); };
  });
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByRole('alert')).toContainText('Storage temporarily unavailable');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Settings' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
});

test('sync pairs two tabs, relays play/pause/rate/seek, and stops on close', async ({ extension }) => {
  const a = await openVideo(extension.context, '?a');
  const b = await openVideo(extension.context, '?b');
  await a.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 10; });
  await b.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 15; });
  const popup = await openUI(extension, 'popup', a);
  const tabIdA = await tabId(popup, a), tabIdB = await tabId(popup, b);
  expect(await rpc(popup, 'START_SYNC', { tabIdA, tabIdB })).toEqual({ success: true });
  expect((await rpc(popup, 'GET_SYNC_STATUS')).offset).toBeCloseTo(5);
  await a.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await a.keyboard.press('d');
  await expect.poll(() => rate(b)).toBeCloseTo(1.1);
  await a.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await a.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 20; });
  await expect.poll(() => b.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(25, 1);
  await b.close();
  await expect.poll(async () => (await rpc(popup, 'GET_SYNC_STATUS')).active).toBe(false);
});

test('replacing a sync session does not deactivate the newly paired agents', async ({ extension }) => {
  const a = await openVideo(extension.context, '?a');
  const b = await openVideo(extension.context, '?b');
  const c = await openVideo(extension.context, '?c');
  const popup = await openUI(extension, 'popup', a);
  const tabIdA = await tabId(popup, a), tabIdB = await tabId(popup, b), tabIdC = await tabId(popup, c);
  expect((await rpc(popup, 'START_SYNC', { tabIdA, tabIdB })).success).toBe(true);
  expect((await rpc(popup, 'START_SYNC', { tabIdA, tabIdB: tabIdC })).success).toBe(true);
  await a.keyboard.press('d');
  await expect.poll(() => rate(c)).toBeCloseTo(1.1);
  expect(await rate(b)).toBe(1);
});

test('cached page lifecycle restores a single working controller', async ({ extension }) => {
  const page = await openVideo(extension.context);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('hare-controller')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('hare-controller')).toHaveCount(1);
  await page.keyboard.press('d');
  await expect.poll(() => rate(page)).toBeCloseTo(1.1);
  await page.goto(fixture + '?empty');
  await page.goBack({ waitUntil: 'commit' });
  await expect(page.locator('hare-controller')).toHaveCount(1);
});

test('a forwarded iframe button targets only its own media', async ({ extension }) => {
  const page = await openVideo(extension.context, '?frame');
  const frame = page.frames().find(frame => frame.url().startsWith('http://localhost:'))!;
  await expect(page.frameLocator('iframe').locator('hare-controller')).toHaveCount(1);
  await frame.evaluate(() => {
    const parent = document.createElement('div');
    parent.innerHTML = '<video width="320" height="180" src="/media.wav"></video>';
    document.body.append(parent);
  });
  const controllers = page.frameLocator('iframe').locator('hare-controller');
  await expect(controllers).toHaveCount(2);
  const controllerId = await controllers.nth(1).getAttribute('id');
  await page.evaluate(controllerId => {
    document.querySelector('iframe')!.contentWindow!.postMessage({ __hareButtonAction: true, controllerId, action: 'faster', value: 0.25 }, '*');
  }, controllerId);
  await expect.poll(() => frame.locator('video').nth(1).evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.25);
  expect(await frame.locator('video').first().evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1);
});

test('controller stays visible in a fullscreen player and restores its mount', async ({ extension }, testInfo) => {
  const page = await openVideo(extension.context);
  await page.locator('#player').evaluate(element => element.requestFullscreen());
  await expect(page.locator('#player > hare-controller')).toHaveCount(1);
  await page.locator('.hare-speed').focus();
  await expect(page.getByRole('button', { name: 'Faster', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Faster', exact: true }).click();
  await expect.poll(() => rate(page)).toBeCloseTo(1.1);
  await page.screenshot({ path: testInfo.outputPath('controller-fullscreen.png') });
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator('.hare-speed')).toBeVisible();
});

test('failed sync startup stays in setup with an actionable error', async ({ extension }) => {
  const a = await openVideo(extension.context, '?a');
  const b = await openVideo(extension.context, '?b');
  const popup = await openUI(extension, 'popup', a);
  await popup.getByRole('button', { name: 'Sync Mode', exact: true }).click();
  await expect(popup.locator('.candidate')).toHaveCount(2);
  await popup.locator('.candidate').nth(0).click();
  await popup.locator('.candidate').nth(1).click();
  await b.close();
  await popup.getByRole('button', { name: 'Start Sync', exact: true }).click();
  await expect(popup.getByRole('alert')).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Refresh tab list' })).toBeEnabled();
  expect((await rpc(popup, 'GET_SYNC_STATUS')).active).toBe(false);
});

test('replacing a paired media source ends the old sync session', async ({ extension }) => {
  const a = await openVideo(extension.context, '?a');
  const b = await openVideo(extension.context, '?b');
  const popup = await openUI(extension, 'popup', a);
  const tabIdA = await tabId(popup, a), tabIdB = await tabId(popup, b);
  expect((await rpc(popup, 'START_SYNC', { tabIdA, tabIdB })).success).toBe(true);
  await a.locator('video').evaluate((video: HTMLVideoElement) => { video.src = '/media.wav?next'; });
  await expect.poll(async () => (await rpc(popup, 'GET_SYNC_STATUS')).active).toBe(false);
});
