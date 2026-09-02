import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isWindowVisible, loadWindowState, saveWindowState, type SavedWindowState } from '../src/windowState';

const temporaryFiles: string[] = [];

afterEach(() => {
  for (const file of temporaryFiles.splice(0)) fs.rmSync(file, { force: true });
});

function temporaryFile(): string {
  const file = path.join(os.tmpdir(), `signote-window-state-${crypto.randomUUID()}.json`);
  temporaryFiles.push(file);
  return file;
}

describe('window state persistence', () => {
  test('round-trips valid bounds and maximized state', () => {
    const file = temporaryFile();
    const state: SavedWindowState = {
      bounds: { x: -1400, y: 80, width: 1100, height: 700 },
      maximized: false,
    };

    saveWindowState(file, state);

    expect(loadWindowState(file)).toEqual(state);
  });

  test('ignores missing, malformed, and invalid state files', () => {
    const missing = temporaryFile();
    expect(loadWindowState(missing)).toBeNull();

    const malformed = temporaryFile();
    fs.writeFileSync(malformed, '{');
    expect(loadWindowState(malformed)).toBeNull();

    const invalid = temporaryFile();
    fs.writeFileSync(invalid, JSON.stringify({ bounds: { x: 0, y: 0, width: -1, height: 10 }, maximized: false }));
    expect(loadWindowState(invalid)).toBeNull();
  });

  test('recognizes a window on a secondary display with negative coordinates', () => {
    expect(
      isWindowVisible(
        { x: -1400, y: 100, width: 1000, height: 700 },
        [
          { x: 0, y: 0, width: 1728, height: 1080 },
          { x: -1920, y: 0, width: 1920, height: 1080 },
        ],
      ),
    ).toBe(true);
  });

  test('rejects bounds from a disconnected display', () => {
    expect(
      isWindowVisible(
        { x: 2500, y: 100, width: 1000, height: 700 },
        [{ x: 0, y: 0, width: 1728, height: 1080 }],
      ),
    ).toBe(false);
  });
});
