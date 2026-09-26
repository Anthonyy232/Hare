
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 2,
    reporter: [['list'], ['html', { open: 'never' }]],
    webServer: {
        command: 'node tests/e2e/server.mjs',
        url: 'http://127.0.0.1:41739/video.html',
        reuseExistingServer: !process.env.CI,
    },
    use: {
        // Preserve the first failure too, including exploratory runs without retries.
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        viewport: { width: 1280, height: 720 },
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
