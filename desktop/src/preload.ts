import { contextBridge, ipcRenderer } from 'electron';
import { createDesktopBridge } from './bridge.js';
import type { DesktopAuthCallback } from './ipc.js';

const platform =
  process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : ('linux' as const);
const appVersionArgument = process.argv.find((argument) => argument.startsWith('--signote-app-version='));
const appVersion = appVersionArgument?.slice('--signote-app-version='.length) ?? 'unknown';
const authListeners = new Map<
  (payload: DesktopAuthCallback) => void,
  (event: Electron.IpcRendererEvent, payload: DesktopAuthCallback) => void
>();

const bridge = createDesktopBridge(
  {
    invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
    on: (channel, listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: DesktopAuthCallback) => listener(payload);
      authListeners.set(listener, wrapped);
      ipcRenderer.on(channel, wrapped);
    },
    send: (channel) => ipcRenderer.send(channel),
    removeListener: (channel, listener) => {
      const wrapped = authListeners.get(listener);
      if (!wrapped) return;
      ipcRenderer.removeListener(channel, wrapped);
      authListeners.delete(listener);
    },
  },
  platform,
  appVersion,
);

contextBridge.exposeInMainWorld('signoteDesktop', bridge);
