import { contextBridge, ipcRenderer } from 'electron';

console.log('[preload] preload script executing...');

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    platform: process.platform,
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChange: (callback: (maximized: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
      ipcRenderer.on('window:maximized-changed', handler);
      return () => ipcRenderer.removeListener('window:maximized-changed', handler);
    },
    sendAppState: (state: unknown) => ipcRenderer.send('app:state-update', state),
    sendNotification: (opts: unknown) => ipcRenderer.send('app:notify', opts),
    onTrayAction: (callback: (action: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action);
      ipcRenderer.on('app:tray-action', handler);
      return () => ipcRenderer.removeListener('app:tray-action', handler);
    },
  });
  console.log('[preload] electronAPI exposed successfully');
} catch (err) {
  console.error('[preload] Failed to expose electronAPI:', err);
}
