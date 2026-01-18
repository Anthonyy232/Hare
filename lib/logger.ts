/**
 * Centralized logging utility for the Hare extension.
 * Set DEBUG = false in production to suppress debug logs.
 */

const DEBUG = false; // Set to true during development, false in production
const PREFIX = '[Hare]';

export const logger = {
  /**
   * Logs informational debug messages (suppressed in production).
   */
  debug(...args: unknown[]): void {
    if (DEBUG) {
      console.log(PREFIX, ...args);
    }
  },

  /**
   * Logs warnings (always shown, even in production).
   */
  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
  },

  /**
   * Logs errors (always shown, even in production).
   */
  error(...args: unknown[]): void {
    console.error(PREFIX, ...args);
  },
};
