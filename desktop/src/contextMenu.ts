import { clipboard, Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron';
import { SELECT_ALL_AT_CHANNEL } from './ipc.js';

type ContextMenuOptions = {
  canOpenExternal: (url: string) => boolean;
  openExternal: (url: string) => void;
};

function appendGroup(template: MenuItemConstructorOptions[], items: MenuItemConstructorOptions[]): void {
  if (items.length === 0) return;
  if (template.length > 0) template.push({ type: 'separator' });
  template.push(...items);
}

function spellingItems(window: BrowserWindow, params: ContextMenuParams): MenuItemConstructorOptions[] {
  if (!params.isEditable || !params.spellcheckEnabled || !params.misspelledWord) return [];

  const suggestions: MenuItemConstructorOptions[] = params.dictionarySuggestions.map((suggestion) => ({
    label: suggestion,
    click: () => window.webContents.replaceMisspelling(suggestion),
  }));

  if (suggestions.length === 0) {
    suggestions.push({ label: 'No Spelling Suggestions', enabled: false });
  }

  suggestions.push(
    { type: 'separator' },
    {
      label: 'Add to Dictionary',
      click: () => window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    },
  );
  return suggestions;
}

function selectAllItem(window: BrowserWindow, params: ContextMenuParams): MenuItemConstructorOptions {
  return {
    label: 'Select All',
    enabled: params.editFlags.canSelectAll,
    click: () => window.webContents.send(SELECT_ALL_AT_CHANNEL, { x: params.x, y: params.y }),
  };
}

function editingItems(window: BrowserWindow, params: ContextMenuParams): MenuItemConstructorOptions[] {
  if (params.isEditable) {
    return [
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      selectAllItem(window, params),
    ];
  }

  const items: MenuItemConstructorOptions[] = [];
  if (params.selectionText) items.push({ role: 'copy', enabled: params.editFlags.canCopy });
  if (items.length > 0) items.push({ type: 'separator' });
  items.push(selectAllItem(window, params));
  return items;
}

export function installContextMenu(window: BrowserWindow, options: ContextMenuOptions): void {
  window.webContents.on('context-menu', (_event, params) => {
    const template: MenuItemConstructorOptions[] = [];

    if (params.linkURL) {
      appendGroup(template, [
        {
          label: 'Open Link',
          enabled: options.canOpenExternal(params.linkURL),
          click: () => options.openExternal(params.linkURL),
        },
        {
          label: 'Copy Link',
          click: () => clipboard.writeText(params.linkURL),
        },
      ]);
    }

    if (params.mediaType === 'image' && params.hasImageContents) {
      appendGroup(template, [
        {
          label: 'Copy Image',
          click: () => window.webContents.copyImageAt(params.x, params.y),
        },
      ]);
    }

    appendGroup(template, spellingItems(window, params));
    appendGroup(template, editingItems(window, params));

    Menu.buildFromTemplate(template).popup({
      window,
      ...(params.frame ? { frame: params.frame } : {}),
      sourceType: params.menuSourceType,
    });
  });
}
