// happy-dom does not implement the browser idle callback API.
globalThis.requestIdleCallback ??= callback => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0);
globalThis.cancelIdleCallback ??= id => clearTimeout(id);
