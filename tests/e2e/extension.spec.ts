
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = path.join(__dirname, '../../.output/chrome-mv3');
const videoFixturePath = path.join(__dirname, 'fixtures/video.html');

test.describe('Extension E2E Tests', () => {
    let browserContext: BrowserContext;
    let page: Page;
    let extensionId: string;

    test.beforeEach(async ({ }) => {
        browserContext = await chromium.launchPersistentContext('', {
            headless: false,
            args: [
                `--disable-extensions-except=${extensionPath}`,
                `--load-extension=${extensionPath}`,
            ],
        });

        let serviceWorker = browserContext.serviceWorkers()[0];
        if (!serviceWorker) {
            serviceWorker = await browserContext.waitForEvent('serviceworker');
        }

        const swUrl = serviceWorker.url();
        extensionId = swUrl.split('/')[2];

        page = await browserContext.newPage();
    });

    test.afterEach(async () => {
        await browserContext.close();
    });

    test('Extension loads and controls video speed', async () => {
        await page.goto(`file://${videoFixturePath}`);
        const video = page.locator('#test-video');
        await expect(video).toBeVisible();

        let playbackRate = await video.evaluate((v: HTMLVideoElement) => v.playbackRate);
        expect(playbackRate).toBe(1);

        await page.keyboard.press('d');
        playbackRate = await video.evaluate((v: HTMLVideoElement) => v.playbackRate);
        expect(playbackRate).toBeGreaterThan(1);

        await page.keyboard.press('s');
        playbackRate = await video.evaluate((v: HTMLVideoElement) => v.playbackRate);
        expect(playbackRate).toBeLessThan(1.2);

        await page.keyboard.press('r');
        playbackRate = await video.evaluate((v: HTMLVideoElement) => v.playbackRate);
        expect(playbackRate).toBe(1);
    });

    test('Extension controls video skipping', async () => {
        await page.goto(`file://${videoFixturePath}`);
        const video = page.locator('#test-video');
        await expect(video).toBeVisible();
        await video.evaluate((v: HTMLVideoElement) => v.play());
        await page.waitForTimeout(1000);

        let initialTime = await video.evaluate((v: HTMLVideoElement) => v.currentTime);

        await page.keyboard.press('x');
        let newTime = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
        expect(newTime).toBeGreaterThan(initialTime);

        await page.waitForTimeout(500);
        initialTime = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
        await page.keyboard.press('z');
        newTime = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
        expect(newTime).toBeLessThan(initialTime);
    });

    test('Extension UI Overlay appears and updates', async () => {
        await page.goto(`file://${videoFixturePath}`);
        const video = page.locator('#test-video');
        await expect(video).toBeVisible();

        const controllerHost = page.locator('hare-controller');
        const speedDisplay = controllerHost.locator('.hare-speed');

        await expect(speedDisplay).toBeVisible();
        await expect(speedDisplay).toHaveText('1.00x');

        await page.keyboard.press('d');
        await expect(speedDisplay).toHaveText(/1\.[1-9]0x/);
    });

    test('Speed resets on reload (No speed persistence)', async () => {
        await page.goto(`file://${videoFixturePath}`);
        const video = page.locator('#test-video');

        await page.keyboard.press('d'); // 1.1x
        let playbackRate = await video.evaluate((v: HTMLVideoElement) => v.playbackRate);
        expect(playbackRate).toBeGreaterThan(1);

        await page.reload();
        await expect(video).toBeVisible();
        await page.waitForTimeout(500); // Allow extension to init

        playbackRate = await video.evaluate((v: HTMLVideoElement) => v.playbackRate);
        expect(playbackRate).toBe(1); // Should reset to 1.0
    });

    test('Extension popup loads', async () => {
        const popupUrl = `chrome-extension://${extensionId}/popup.html`;
        await page.goto(popupUrl);
        const title = await page.title();
        expect(title).toBeTruthy();
        await expect(page.locator('body')).toBeVisible();
    });
});
