import { contextBridge, ipcRenderer } from 'electron';
import { createDesktopBridge, toDesktopPlatform } from './bridge.js';
import { SELECT_ALL_AT_CHANNEL, type DesktopAuthCallback, type DesktopPoint } from './ipc.js';

const platform = toDesktopPlatform(process.platform);
const appVersionArgument = process.argv.find((argument) => argument.startsWith('--signote-app-version='));
const appVersion = appVersionArgument?.slice('--signote-app-version='.length) ?? 'unknown';
const authListeners = new Map<
  (payload: DesktopAuthCallback) => void,
  (event: Electron.IpcRendererEvent, payload: DesktopAuthCallback) => void
>();

function selectNodeContents(node: Element): void {
  const selection = node.ownerDocument.getSelection();
  if (!selection) return;

  const range = node.ownerDocument.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

ipcRenderer.on(SELECT_ALL_AT_CHANNEL, (_event, point: DesktopPoint) => {
  const target = document.elementFromPoint(point.x, point.y);
  if (!target) return;

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.select();
    return;
  }

  const noteEditor = target.closest('[data-testid="tiptap-editor"]')?.querySelector('.ProseMirror');
  const editable = target.closest('[contenteditable="true"]');
  const selectionScope = noteEditor ?? editable;

  if (selectionScope) {
    selectNodeContents(selectionScope);
    return;
  }

  selectNodeContents(document.body);
});

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
