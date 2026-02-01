import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import path from 'node:path';
import type { AppStateUpdate, AppStatus } from '@cloudscode/shared';

const STATUS_LABELS: Record<AppStatus, string> = {
  idle: 'Idle',
  processing: 'Processing...',
  error: 'Error',
  completed: 'Completed',
};

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow;
  private icons: Record<string, Electron.NativeImage> = {};
  private lastStatus: AppStatus = 'idle';

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.loadIcons();
    this.createTray();
  }

  private getIconsDir(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'icons');
    }
    return path.join(__dirname, '..', 'resources', 'icons');
  }

  private loadIcons() {
    const iconsDir = this.getIconsDir();
    const isMac = process.platform === 'darwin';

    for (const status of ['idle', 'processing', 'error', 'completed'] as AppStatus[]) {
      if (isMac) {
        // Use Template images for macOS menu bar (adapts to dark/light mode)
        const templatePath = path.join(iconsDir, `tray-${status}Template.png`);
        const img = nativeImage.createFromPath(templatePath);
        img.setTemplateImage(true);
        this.icons[status] = img;
      } else {
        const iconPath = path.join(iconsDir, `tray-${status}.png`);
        this.icons[status] = nativeImage.createFromPath(iconPath);
      }
    }
  }

  private createTray() {
    const icon = this.icons['idle'];
    if (!icon || icon.isEmpty()) {
      console.warn('[tray-manager] Idle tray icon is empty, creating fallback');
      this.tray = new Tray(nativeImage.createEmpty());
    } else {
      this.tray = new Tray(icon);
    }

    this.tray.setToolTip('CLouds Code');
    this.buildMenu({ status: 'idle', runningAgentCount: 0, hasError: false, unreadCompletions: 0 });

    this.tray.on('click', () => {
      this.showWindow();
    });
  }

  private showWindow() {
    if (this.mainWindow.isDestroyed()) return;
    this.mainWindow.show();
    this.mainWindow.focus();
    this.mainWindow.webContents.send('app:tray-action', 'show-window');
  }

  update(state: AppStateUpdate) {
    if (!this.tray || this.tray.isDestroyed()) return;

    // Update icon
    if (state.status !== this.lastStatus) {
      const icon = this.icons[state.status];
      if (icon && !icon.isEmpty()) {
        this.tray.setImage(icon);
      }
      this.lastStatus = state.status;
    }

    // Update tooltip
    let tooltip = 'CLouds Code';
    if (state.activeProjectTitle) {
      tooltip += ` - ${state.activeProjectTitle}`;
    }
    tooltip += ` (${STATUS_LABELS[state.status]})`;
    this.tray.setToolTip(tooltip);

    // Rebuild context menu
    this.buildMenu(state);
  }

  private buildMenu(state: AppStateUpdate) {
    if (!this.tray || this.tray.isDestroyed()) return;

    const menuItems: Electron.MenuItemConstructorOptions[] = [
      { label: 'CLouds Code', enabled: false },
      { label: `Status: ${STATUS_LABELS[state.status]}`, enabled: false },
      { type: 'separator' },
    ];

    if (state.activeProjectTitle) {
      menuItems.push({ label: state.activeProjectTitle, enabled: false });
    }

    if (state.runningAgentCount > 0) {
      menuItems.push({ label: `Agents running: ${state.runningAgentCount}`, enabled: false });
    }

    if (state.planProgress) {
      menuItems.push({
        label: `Plan: ${state.planProgress.current}/${state.planProgress.total} steps`,
        enabled: false,
      });
    }

    if (state.unreadCompletions > 0) {
      menuItems.push({ label: `${state.unreadCompletions} unread completion(s)`, enabled: false });
    }

    menuItems.push(
      { type: 'separator' },
      {
        label: 'Show Window',
        click: () => this.showWindow(),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.exit(0);
        },
      },
    );

    const menu = Menu.buildFromTemplate(menuItems);
    this.tray.setContextMenu(menu);
  }

  get isActive(): boolean {
    return this.tray !== null && !this.tray.isDestroyed();
  }

  dispose() {
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy();
    }
    this.tray = null;
  }
}
