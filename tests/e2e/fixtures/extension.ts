import { test as base, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '../../../lib/types';

export { expect };
export const fixture = 'http://127.0.0.1:41739/video.html';
export const extensionPath = path.resolve('.output/chrome-mv3');

export async function launchExtension(profile: string) {
  return chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: process.env.HARE_HEADED !== '1',
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
}

export const test = base.extend<{ extension: { context: BrowserContext; worker: Worker; id: string } }>({
  extension: async ({}, use, testInfo) => {
    const context = await launchExtension(testInfo.outputPath('profile'));
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

export async function openVideo(context: BrowserContext, query = '') {
  const page = await context.newPage();
  await page.goto(fixture + query);
  if (!query.includes('empty') && !query.includes('frame')) {
    await expect(page.locator('hare-controller')).toHaveCount(1);
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  }
  return page;
}
export async function openUI(extension: { context: BrowserContext; id: string }, filename: string, active?: Page) {
  const page = await extension.context.newPage();
  if (active) await active.bringToFront();
  await page.goto(`chrome-extension://${extension.id}/${filename}.html`);
  return page;
}
export async function rate(page: Page) { return page.locator('video').first().evaluate((video: HTMLVideoElement) => video.playbackRate); }
export async function setSettings(worker: Worker, patch: Partial<Settings>) {
  await worker.evaluate(async patch => {
    const api = (globalThis as any).chrome;
    const stored = await api.storage.sync.get('hare-settings');
    await api.storage.sync.set({ 'hare-settings': { ...stored['hare-settings'], ...patch } });
  }, patch);
}
export async function rpc(page: Page, type: string, payload?: unknown): Promise<any> {
  return page.evaluate(({ type, payload }) => (globalThis as any).chrome.runtime.sendMessage({ type, payload }), { type, payload });
}
export async function tabId(page: Page, target: Page): Promise<number> {
  return page.evaluate(async url => {
    const tabs = await (globalThis as any).chrome.tabs.query({});
    return tabs.find((tab: any) => tab.url === url).id;
  }, target.url());
}
