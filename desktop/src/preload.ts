import { contextBridge, ipcRenderer } from 'electron';
import {
  AUTH_CALLBACK_CHANNEL,
  AUTH_CALLBACK_READY_CHANNEL,
  START_BROWSER_LOGIN_CHANNEL,
  type DesktopAuthCallback,
} from './ipc.js';

const platform =
  process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : ('linux' as const);
const appVersionArgument = process.argv.find((argument) => argument.startsWith('--signote-app-version='));
const appVersion = appVersionArgument?.slice('--signote-app-version='.length) ?? 'unknown';

contextBridge.exposeInMainWorld(
  'signoteDesktop',
  Object.freeze({
    isDesktop: true,
    platform,
    appVersion,
    startBrowserLogin: (url: string) => ipcRenderer.invoke(START_BROWSER_LOGIN_CHANNEL, url),
    onAuthCallback: (callback: (payload: DesktopAuthCallback) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: DesktopAuthCallback) => callback(payload);
      ipcRenderer.on(AUTH_CALLBACK_CHANNEL, listener);
      ipcRenderer.send(AUTH_CALLBACK_READY_CHANNEL);
      return () => ipcRenderer.removeListener(AUTH_CALLBACK_CHANNEL, listener);
    },
  }),
);
