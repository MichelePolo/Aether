import { app, BrowserWindow, dialog, shell } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** @type {import('aether-core').AetherRuntime | undefined} */
let runtime;
/** @type {Promise<import('aether-core').AetherRuntime> | undefined} */
let runtimePromise;
let quitting = false;

function embeddedCoreOptions() {
  const userData = app.getPath('userData');
  // Electron owns its lifecycle, while the Aether core owns the HTTP API. The
  // dynamic port eliminates collisions with a browser/CLI server on :3000.
  process.env.AETHER_EMBEDDED = '1';
  // The desktop dev command builds the SPA first, so the embedded core must
  // serve that build rather than initializing Vite middleware.
  process.env.NODE_ENV = 'production';
  return {
    embedded: true,
    host: '127.0.0.1',
    port: 0,
    dataDir: path.join(userData, 'data'),
    libraryDir: path.join(userData, 'library'),
  };
}

async function startRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const options = embeddedCoreOptions();
      const core = require('aether-core/dist/server.cjs');
      const started = await core.bootstrap(options);
      runtime = started;
      return started;
    })();
  }
  return runtimePromise;
}

function isRuntimeUrl(url) {
  return runtime && new URL(url).origin === runtime.baseUrl;
}

async function createWindow() {
  const core = await startRuntime();
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(import.meta.dirname, 'preload.cjs'),
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isRuntimeUrl(url)) event.preventDefault();
  });

  await window.loadURL(core.baseUrl);
}

app.whenReady().then(createWindow).catch(async (error) => {
  console.error('Aether desktop failed to start:', error);
  await dialog.showMessageBox({
    type: 'error',
    title: 'Aether could not start',
    message: 'The embedded Aether service could not be started.',
    detail: error instanceof Error ? error.message : String(error),
  });
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (!runtime || quitting) return;
  event.preventDefault();
  quitting = true;
  runtime.close().catch((error) => {
    console.error('Aether desktop shutdown failed:', error);
  }).finally(() => app.quit());
});
