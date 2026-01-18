import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        alias: {
            '#imports': path.resolve(__dirname, './tests/__mocks__/wxt-imports.ts'),
        },
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/e2e/**', // Exclude Playwright E2E tests
        ],
    },
});
