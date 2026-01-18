import { loadSettings, saveSettings } from '../lib/settings';
import { logger } from '../lib/logger';

export default defineBackground(() => {
  /**
   * Initializes or validates settings on installation/update to ensure
   * the sync storage contains a valid schema version.
   */
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install' || details.reason === 'update') {
      try {
        const settings = await loadSettings();
        await saveSettings(settings);
      } catch (error) {
        // Critical: Settings initialization failed - attempt recovery
        logger.error('Settings initialization failed:', error);
        try {
          const { DEFAULT_SETTINGS } = await import('../lib/types');
          await saveSettings(DEFAULT_SETTINGS);
          logger.warn('Settings recovered using defaults');
        } catch (recoveryError) {
          // Complete failure - log and continue (extension will use in-memory defaults)
          logger.error('Settings recovery failed:', recoveryError);
          logger.error('Extension will function with reduced capability until settings are manually reset');
        }
      }
    }
  });
});
