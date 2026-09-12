
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    // Fail the build on CI if you accidentally left test.only in the source code.
    forbidOnly: !!process.env.CI,
    // Retry on CI only.
    retries: process.env.CI ? 2 : 0,
    // Opt out of parallel tests on CI.
    workers: 2,
    // Reporter to use. See https://playwright.dev/docs/test-reporters
    reporter: [['list'], ['html', { open: 'never' }]],
    webServer: {
        command: 'node tests/e2e/server.mjs',
        url: 'http://127.0.0.1:41739/video.html',
        reuseExistingServer: !process.env.CI,
    },
    // Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions.
    use: {
        // Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer
        trace: 'on-first-retry',
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
