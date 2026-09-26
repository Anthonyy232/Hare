import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-svelte'],
  svelte: {
    vite: {
      // Build templates with DOM nodes, avoiding runtime innerHTML sinks in extension pages.
      compilerOptions: { fragments: 'tree' },
    },
  },
  zip: {
    // Only build inputs belong in the Firefox source archive, never local test profiles/reports.
    includeSources: [
      'entrypoints/**', 'components/**', 'lib/**', 'assets/**', 'public/**', 'tests/**',
      'README.md', 'LICENSE', 'package.json', 'package-lock.json', 'tsconfig.json',
      'wxt.config.ts', 'vitest.config.ts', 'playwright.config.ts',
    ],
  },
  manifest: {
    name: 'Hare',
    description: 'Control HTML5 video/audio playback speed with keyboard shortcuts',
    permissions: ['storage', 'webNavigation'],
    host_permissions: ['http://*/*', 'https://*/*', 'file:///*'],
    icons: {
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    action: {
      default_icon: {
        19: 'icons/icon19.png',
        38: 'icons/icon38.png',
      },
    },
    browser_specific_settings: {
      gecko: {
        id: 'hare@anthonyy232.github.io',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
});
