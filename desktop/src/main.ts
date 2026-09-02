import path from 'node:path';
import { app, BrowserWindow, ipcMain, screen, session, shell } from 'electron';
import { AuthCallbackQueue, focusDesktopWindow } from './authCallbackQueue.js';
import { findDesktopAuthCallback, parseDesktopAuthCallback } from './deepLinks.js';
import {
  AUTH_CALLBACK_CHANNEL,
  AUTH_CALLBACK_READY_CHANNEL,
  START_BROWSER_LOGIN_CHANNEL,
  type DesktopAuthCallback,
} from './ipc.js';
import { isAllowedAppNavigation, isAllowedBrowserLoginUrl, isSafeExternalUrl, resolveAppOrigin } from './security.js';
import { isWindowVisible, loadWindowState, saveWindowState } from './windowState.js';

const PROTOCOL = 'signote';
// Must match build.appId so Windows groups the taskbar button with the
// Start-menu shortcut the NSIS installer creates.
const APP_USER_MODEL_ID = 'app.signote.desktop';
// Cookie encryption was enabled in the original partition. Electron documents
// disabling that fuse as a one-way transition that leaves the old cookie store
// unreadable, so the unencrypted personal-build channel starts with a clean DB.
const SESSION_PARTITION = 'persist:signote-v2';
const DEFAULT_WINDOW_BOUNDS = { width: 1280, height: 820 };

let mainWindow: BrowserWindow | null = null;
const authCallbackQueue = new AuthCallbackQueue();
const appOrigin = resolveAppOrigin(app.isPackaged);

function focusMainWindow(): void {
  focusDesktopWindow(mainWindow);
}

function flushAuthCallback(): void {
  if (!mainWindow) return;
  authCallbackQueue.flush((callback) => mainWindow?.webContents.send(AUTH_CALLBACK_CHANNEL, callback));
}

function handleAuthCallback(callback: DesktopAuthCallback | null): void {
  if (!callback) return;
  authCallbackQueue.receive(callback);
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
    authCallbackQueue.markRendererReady();
    flushAuthCallback();
  });
}

function createWindow(): BrowserWindow {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  const savedState = loadWindowState(stateFile);
  const displayWorkAreas = screen.getAllDisplays().map((display) => display.workArea);
  const savedBounds = savedState?.bounds;
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  const fallbackBounds = {
    width: Math.min(DEFAULT_WINDOW_BOUNDS.width, primaryWorkArea.width),
    height: Math.min(DEFAULT_WINDOW_BOUNDS.height, primaryWorkArea.height),
    x: primaryWorkArea.x + Math.max(0, Math.floor((primaryWorkArea.width - DEFAULT_WINDOW_BOUNDS.width) / 2)),
    y: primaryWorkArea.y + Math.max(0, Math.floor((primaryWorkArea.height - DEFAULT_WINDOW_BOUNDS.height) / 2)),
  };
  const restoredBounds = savedBounds && isWindowVisible(savedBounds, displayWorkAreas) ? savedBounds : fallbackBounds;
  const window = new BrowserWindow({
    ...restoredBounds,
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
  if (savedState?.maximized) window.maximize();
  window.webContents.setUserAgent(`${window.webContents.getUserAgent()} SigNoteDesktop/${app.getVersion()}`);

  let saveBoundsTimer: NodeJS.Timeout | undefined;
  const persistWindowState = (): void => {
    if (window.isDestroyed()) return;
    saveWindowState(stateFile, {
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
    });
  };
  const scheduleWindowStateSave = (): void => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(persistWindowState, 250);
  };

  window.on('move', scheduleWindowStateSave);
  window.on('resize', scheduleWindowStateSave);
  window.on('maximize', scheduleWindowStateSave);
  window.on('unmaximize', scheduleWindowStateSave);

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
    authCallbackQueue.markRendererLoading();
  });
  window.on('closed', () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    if (mainWindow === window) {
      authCallbackQueue.markRendererLoading();
      mainWindow = null;
    }
  });
  window.on('close', persistWindowState);

  void window.loadURL(appOrigin.href);
  return window;
}

if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

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
