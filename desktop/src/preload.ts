import { contextBridge, ipcRenderer } from 'electron';
import { START_BROWSER_LOGIN_CHANNEL } from './ipc.js';

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
  }),
);
