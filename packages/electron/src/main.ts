import { app, BrowserWindow, dialog, shell, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

// Match the linux executableName so the DE associates our window with the
// .desktop file (and therefore the icon).
if (process.platform === 'linux') {
  app.setName('clouds-code');
}

// ── Single instance lock ──────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ── Helpers ───────────────────────────────────────────────────────────

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not determine port')));
      }
    });
    srv.on('error', reject);
  });
}

function resolveWebDist(): string {
  return path.join(process.resourcesPath, 'web-dist');
}

// ── Window ────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

async function createWindow(url: string): Promise<BrowserWindow> {
  const preloadPath = path.join(__dirname, 'preload.cjs');
  const preloadExists = fs.existsSync(preloadPath);
  console.log(`[main] Preload path: ${preloadPath}`);
  console.log(`[main] Preload file exists: ${preloadExists}`);
  if (!preloadExists) {
    console.error('[main] WARNING: preload.js not found! Run "pnpm build" in packages/electron first.');
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    title: 'CLouds Code',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('preload-error', (_event, preload, error) => {
    console.error(`[main] Preload error in ${preload}:`, error);
  });

  if (isDev) {
    win.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
      console.log(`[renderer] ${message} (${sourceId}:${line})`);
    });
  }

  await win.loadURL(url);

  if (isDev) {
    win.webContents.openDevTools();
  }

  return win;
}

// ── IPC handlers for window controls ──────────────────────────────────

ipcMain.on('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.isMaximized() ? win.unmaximize() : win.maximize();
  }
});

ipcMain.on('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('window:isMaximized', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});

// ── App lifecycle ─────────────────────────────────────────────────────

let shutdownServer: (() => void) | null = null;

app.whenReady().then(async () => {
  try {
    let loadUrl: string;

    if (isDev) {
      // Dev mode: server + vite already running via `pnpm dev`
      // Electron is just a browser window pointing at the Vite dev server
      loadUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    } else {
      // Production: start the embedded server
      const port = await findFreePort();

      process.env.PORT = String(port);
      process.env.HOST = '127.0.0.1';
      process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');

      const staticDir = resolveWebDist();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serverModule = await import('@cloudscode/server') as any;
      const startServer = serverModule.startServer ?? serverModule.default?.startServer;
      if (typeof startServer !== 'function') {
        throw new Error(
          `Could not find startServer export. Module keys: ${Object.keys(serverModule)}`
        );
      }
      const handle = await startServer({ staticDir });
      shutdownServer = handle.shutdown;

      loadUrl = `http://127.0.0.1:${port}`;
    }

    mainWindow = await createWindow(loadUrl);

    mainWindow.on('maximize', () => {
      mainWindow?.webContents.send('window:maximized-changed', true);
    });
    mainWindow.on('unmaximize', () => {
      mainWindow?.webContents.send('window:maximized-changed', false);
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    app.on('window-all-closed', () => {
      shutdownServer?.();
      app.quit();
    });

    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.error('Failed to start:', err);
    const crashLogPath = path.join(app.getPath('userData'), 'crash.log');
    const errorMessage = err instanceof Error
      ? `${err.message}\n\n${err.stack}` : String(err);
    try {
      fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
      fs.writeFileSync(crashLogPath,
        `[${new Date().toISOString()}] Failed to start:\n${errorMessage}\n\n`,
        { flag: 'a' });
    } catch { /* ignore */ }
    dialog.showErrorBox('CLouds Code - Failed to Start',
      `The application failed to start.\n\n${errorMessage}\n\nCrash log: ${crashLogPath}`);
    app.quit();
  }
});
