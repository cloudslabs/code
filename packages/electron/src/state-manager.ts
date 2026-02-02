import { app, BrowserWindow, Notification, ipcMain, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppStateUpdate, AppStatus, NotificationRequest } from '@cloudscode/shared';
import { TrayManager } from './tray-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STATUS_SUFFIXES: Record<AppStatus, string> = {
  idle: '',
  processing: ' — Processing',
  error: ' — Error',
  completed: ' — Completed',
};

export class StateManager {
  private mainWindow: BrowserWindow;
  private trayManager: TrayManager;
  private dockIcons: Record<string, Electron.NativeImage> = {};
  private overlayIcons: Record<string, Electron.NativeImage> = {};
  private badgeIcons: Record<string, Electron.NativeImage> = {};
  private lastStatus: AppStatus = 'idle';
  private lastUnread = 0;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.trayManager = new TrayManager(mainWindow);
    this.loadIcons();
    this.registerIpcListeners();
  }

  private getIconsDir(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'icons');
    }
    return path.join(__dirname, '..', 'resources', 'icons');
  }

  private loadIcons() {
    const iconsDir = this.getIconsDir();

    // Dock icons (macOS)
    if (process.platform === 'darwin') {
      for (const status of ['idle', 'processing', 'error', 'completed'] as AppStatus[]) {
        this.dockIcons[status] = nativeImage.createFromPath(
          path.join(iconsDir, `dock-${status}.png`),
        );
      }
    }

    // Overlay icons (Windows)
    if (process.platform === 'win32') {
      for (const status of ['processing', 'error', 'completed']) {
        this.overlayIcons[status] = nativeImage.createFromPath(
          path.join(iconsDir, `overlay-${status}.png`),
        );
      }
      // Badge overlays
      for (let i = 1; i <= 9; i++) {
        this.badgeIcons[String(i)] = nativeImage.createFromPath(
          path.join(iconsDir, `badge-${i}.png`),
        );
      }
      this.badgeIcons['9+'] = nativeImage.createFromPath(
        path.join(iconsDir, 'badge-9plus.png'),
      );
    }
  }

  private registerIpcListeners() {
    ipcMain.on('app:state-update', (_event, state: AppStateUpdate) => {
      this.onStateUpdate(state);
    });

    ipcMain.on('app:notify', (_event, opts: NotificationRequest) => {
      this.sendNotification(opts);
    });
  }

  private onStateUpdate(state: AppStateUpdate) {
    // Update window title
    const suffix = STATUS_SUFFIXES[state.status] || '';
    const title = `CLouds Code${suffix}`;
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.setTitle(title);
    }

    // Platform-specific updates
    switch (process.platform) {
      case 'darwin':
        this.updateMacOS(state);
        break;
      case 'win32':
        this.updateWindows(state);
        break;
      case 'linux':
        this.updateLinux(state);
        break;
    }

    // Always update tray
    this.trayManager.update(state);

    this.lastStatus = state.status;
    this.lastUnread = state.unreadCompletions;
  }

  private updateMacOS(state: AppStateUpdate) {
    // Dynamic dock icon
    const dockIcon = this.dockIcons[state.status];
    if (dockIcon && !dockIcon.isEmpty()) {
      try {
        app.dock?.setIcon(dockIcon);
      } catch {
        // dock API may not be available in all contexts
      }
    }

    // Badge count on dock
    try {
      app.dock?.setBadge(state.unreadCompletions > 0 ? String(state.unreadCompletions) : '');
    } catch {
      // ignore
    }

    // Dock bounce on completion/error while unfocused
    if (!this.mainWindow.isDestroyed() && !this.mainWindow.isFocused()) {
      if (
        (state.status === 'completed' && this.lastStatus !== 'completed') ||
        (state.status === 'error' && this.lastStatus !== 'error')
      ) {
        try {
          app.dock?.bounce('informational');
        } catch {
          // ignore
        }
      }
    }
  }

  private updateWindows(state: AppStateUpdate) {
    if (this.mainWindow.isDestroyed()) return;

    // Overlay icon for status
    if (state.status === 'idle') {
      this.mainWindow.setOverlayIcon(null, '');
    } else {
      const overlay = this.overlayIcons[state.status];
      if (overlay && !overlay.isEmpty()) {
        this.mainWindow.setOverlayIcon(overlay, STATUS_SUFFIXES[state.status].trim());
      }
    }

    // Progress bar
    if (state.status === 'processing') {
      if (state.planProgress && state.planProgress.total > 0) {
        const progress = state.planProgress.current / state.planProgress.total;
        this.mainWindow.setProgressBar(progress);
      } else {
        // Indeterminate progress
        this.mainWindow.setProgressBar(2, { mode: 'indeterminate' });
      }
    } else if (state.status === 'error') {
      this.mainWindow.setProgressBar(1, { mode: 'error' });
    } else {
      this.mainWindow.setProgressBar(-1); // Remove progress bar
    }

    // Flash frame on completion/error while unfocused
    if (!this.mainWindow.isFocused()) {
      if (
        (state.status === 'completed' && this.lastStatus !== 'completed') ||
        (state.status === 'error' && this.lastStatus !== 'error')
      ) {
        this.mainWindow.flashFrame(true);
      }
    }
  }

  private updateLinux(state: AppStateUpdate) {
    if (this.mainWindow.isDestroyed()) return;

    // Badge count (best-effort, works on GNOME with unity launcher API)
    try {
      app.setBadgeCount(state.unreadCompletions);
    } catch {
      // Not supported on all DEs
    }

    // Progress bar (supported on some DEs via Unity launcher API)
    if (state.status === 'processing') {
      if (state.planProgress && state.planProgress.total > 0) {
        const progress = state.planProgress.current / state.planProgress.total;
        this.mainWindow.setProgressBar(progress);
      } else {
        this.mainWindow.setProgressBar(2, { mode: 'indeterminate' });
      }
    } else if (state.status === 'error') {
      this.mainWindow.setProgressBar(1, { mode: 'error' });
    } else {
      this.mainWindow.setProgressBar(-1);
    }

    // Flash frame on completion/error while unfocused
    if (!this.mainWindow.isFocused()) {
      if (
        (state.status === 'completed' && this.lastStatus !== 'completed') ||
        (state.status === 'error' && this.lastStatus !== 'error')
      ) {
        this.mainWindow.flashFrame(true);
      }
    }
  }

  private sendNotification(opts: NotificationRequest) {
    if (!Notification.isSupported()) return;

    const iconsDir = this.getIconsDir();
    const notification = new Notification({
      title: opts.title,
      body: opts.body,
      icon: path.join(iconsDir, '..', 'icon.png'),
      urgency: opts.urgency,
    });

    notification.on('click', () => {
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.show();
        this.mainWindow.focus();
      }
    });

    notification.show();
  }

  get tray(): TrayManager {
    return this.trayManager;
  }

  dispose() {
    ipcMain.removeAllListeners('app:state-update');
    ipcMain.removeAllListeners('app:notify');
    this.trayManager.dispose();
  }
}
