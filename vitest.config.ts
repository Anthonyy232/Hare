import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
    plugins: [WxtVitest()],
    test: {
        environment: 'happy-dom',
        exclude: [
            ...configDefaults.exclude,
            '**/e2e/**',
        ],
    },
});
