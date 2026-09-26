const DEBUG = import.meta.env.DEV;
const PREFIX = '[Hare]';

export const logger = {
  debug(...args: unknown[]): void {
    if (DEBUG) {
      console.log(PREFIX, ...args);
    }
  },

  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
  },

  error(...args: unknown[]): void {
    console.error(PREFIX, ...args);
  },
};
