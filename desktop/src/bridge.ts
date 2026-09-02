import {
  AUTH_CALLBACK_CHANNEL,
  AUTH_CALLBACK_READY_CHANNEL,
  START_BROWSER_LOGIN_CHANNEL,
  type DesktopAuthCallback,
} from './ipc.js';

export type DesktopPlatform = 'macos' | 'windows' | 'linux';

export function toDesktopPlatform(nodePlatform: NodeJS.Platform | string): DesktopPlatform {
  if (nodePlatform === 'darwin') return 'macos';
  if (nodePlatform === 'win32') return 'windows';
  // Every remaining desktop target Electron supports is an X11/Wayland
  // platform that behaves like Linux for the renderer's purposes.
  return 'linux';
}

export type DesktopIpc = {
  invoke(channel: string, payload: string): Promise<unknown>;
  on(channel: string, listener: (payload: DesktopAuthCallback) => void): void;
  send(channel: string): void;
  removeListener(channel: string, listener: (payload: DesktopAuthCallback) => void): void;
};

export function createDesktopBridge(ipc: DesktopIpc, platform: DesktopPlatform, appVersion: string) {
  return Object.freeze({
    isDesktop: true as const,
    platform,
    appVersion,
    startBrowserLogin: async (url: string): Promise<void> => {
      await ipc.invoke(START_BROWSER_LOGIN_CHANNEL, url);
    },
    onAuthCallback: (callback: (payload: DesktopAuthCallback) => void) => {
      const listener = (payload: DesktopAuthCallback) => callback(payload);
      ipc.on(AUTH_CALLBACK_CHANNEL, listener);
      ipc.send(AUTH_CALLBACK_READY_CHANNEL);
      return () => ipc.removeListener(AUTH_CALLBACK_CHANNEL, listener);
    },
  });
}
