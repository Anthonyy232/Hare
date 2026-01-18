
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

    test('Extension persists SETTINGS (Start Hidden) after reload', async () => {
        // 1. Verify default state (Visible)
        await page.goto(`file://${videoFixturePath}`);
        const controllerHost = page.locator('hare-controller');
        const internalController = controllerHost.locator('.hare-controller');
        await expect(internalController).not.toHaveClass(/hidden/);

        // 2. Open Options Page and change setting
        const optionsUrl = `chrome-extension://${extensionId}/options.html`;
        await page.goto(optionsUrl);

        // Find toggle for "Start with controller hidden"
        // Based on analysis, it's a checkbox inside a label
        // "Start with controller hidden" text is in broken spans, so strict text match might fail.
        // But "Start with controller hidden" is in .toggle-label
        // Use force check on the hidden input
        const hideToggle = page.locator('.toggle-row', { hasText: 'Start with controller hidden' }).locator('input[type="checkbox"]');
        await hideToggle.check({ force: true });

        // Save
        const saveBtn = page.locator('button.btn.primary', { hasText: 'Save Settings' });
        await saveBtn.click();
        await expect(saveBtn).toHaveText('✓ Saved');

        // 3. Navigate back to video and verify hidden
        await page.goto(`file://${videoFixturePath}`);
        await expect(internalController).toHaveClass(/hidden/);

        // 4. Reset setting for cleanup (optional, but good practice if context persists partially, though launchPersistentContext is usually fresh or user-data-dir dependent)
        // Actually context is closed after test, so no need to cleanup unless reusing profile.
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
