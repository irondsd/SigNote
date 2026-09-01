import path from 'node:path';
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { findDesktopAuthCallback, parseDesktopAuthCallback } from './deepLinks.js';
import {
  AUTH_CALLBACK_CHANNEL,
  AUTH_CALLBACK_READY_CHANNEL,
  START_BROWSER_LOGIN_CHANNEL,
  type DesktopAuthCallback,
} from './ipc.js';
import { isAllowedAppNavigation, isAllowedBrowserLoginUrl, isSafeExternalUrl, resolveAppOrigin } from './security.js';

const PROTOCOL = 'signote';
const SESSION_PARTITION = 'persist:signote';

let mainWindow: BrowserWindow | null = null;
let pendingAuthCallback: DesktopAuthCallback | null = null;
let authCallbackRendererReady = false;
const appOrigin = resolveAppOrigin(app.isPackaged);

function focusMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function flushAuthCallback(): void {
  if (!mainWindow || !authCallbackRendererReady || !pendingAuthCallback) return;
  mainWindow.webContents.send(AUTH_CALLBACK_CHANNEL, pendingAuthCallback);
  pendingAuthCallback = null;
}

function handleAuthCallback(callback: DesktopAuthCallback | null): void {
  if (!callback) return;
  pendingAuthCallback = callback;
  focusMainWindow();
  flushAuthCallback();
}

function registerProtocol(): void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    return;
  }

  app.setAsDefaultProtocolClient(PROTOCOL);
}

function openExternal(rawUrl: string): void {
  if (!isSafeExternalUrl(rawUrl)) return;
  void shell.openExternal(rawUrl);
}

async function configureSession(): Promise<void> {
  const desktopSession = session.fromPartition(SESSION_PARTITION);

  desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  desktopSession.setPermissionCheckHandler(() => false);
  await desktopSession.clearStorageData({ storages: ['serviceworkers'] });
}

function configureIpc(): void {
  ipcMain.handle(START_BROWSER_LOGIN_CHANNEL, async (event, rawUrl: unknown) => {
    if (event.sender !== mainWindow?.webContents || typeof rawUrl !== 'string') {
      throw new Error('Rejected desktop browser-login request');
    }
    if (!isAllowedBrowserLoginUrl(rawUrl, appOrigin)) {
      throw new Error('Rejected untrusted desktop browser-login URL');
    }

    await shell.openExternal(rawUrl);
  });

  ipcMain.on(AUTH_CALLBACK_READY_CHANNEL, (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    authCallbackRendererReady = true;
    flushAuthCallback();
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    title: 'SigNote',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      partition: SESSION_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
      additionalArguments: [`--signote-app-version=${app.getVersion()}`],
    },
  });
  window.webContents.setUserAgent(`${window.webContents.getUserAgent()} SigNoteDesktop/${app.getVersion()}`);

  const guardNavigation = (event: Electron.Event, targetUrl: string): void => {
    if (isAllowedAppNavigation(targetUrl, appOrigin)) return;

    event.preventDefault();
    openExternal(targetUrl);
  };

  window.webContents.on('will-navigate', guardNavigation);
  window.webContents.on('will-redirect', guardNavigation);
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.on('did-start-loading', () => {
    authCallbackRendererReady = false;
  });
  window.on('closed', () => {
    if (mainWindow === window) {
      authCallbackRendererReady = false;
      mainWindow = null;
    }
  });

  void window.loadURL(appOrigin.href);
  return window;
}

registerProtocol();

app.on('open-url', (event, rawUrl) => {
  event.preventDefault();
  handleAuthCallback(parseDesktopAuthCallback(rawUrl));
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    handleAuthCallback(findDesktopAuthCallback(commandLine));
    focusMainWindow();
  });

  app.whenReady().then(async () => {
    await configureSession();
    configureIpc();
    mainWindow = createWindow();
    handleAuthCallback(findDesktopAuthCallback(process.argv));

    app.on('activate', () => {
      if (!mainWindow) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
