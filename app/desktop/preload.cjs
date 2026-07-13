const { contextBridge } = require('electron');

// This deliberately exposes no filesystem, process, or IPC primitives. It is
// only a future-safe place for small, reviewed desktop integrations.
contextBridge.exposeInMainWorld('aetherDesktop', Object.freeze({
  platform: process.platform,
  isDesktop: true,
}));
