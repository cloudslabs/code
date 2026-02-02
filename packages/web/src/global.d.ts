import type { AppStateUpdate, NotificationRequest } from '@cloudscode/shared';

interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  sendAppState: (state: AppStateUpdate) => void;
  sendNotification: (opts: NotificationRequest) => void;
  onTrayAction: (callback: (action: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
