import fs from 'node:fs';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedWindowState {
  bounds: WindowBounds;
  maximized: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isWindowBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== 'object') return false;
  const bounds = value as Partial<WindowBounds>;
  return (
    isFiniteNumber(bounds.x) &&
    isFiniteNumber(bounds.y) &&
    isFiniteNumber(bounds.width) &&
    isFiniteNumber(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

export function loadWindowState(filePath: string): SavedWindowState | null {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<SavedWindowState>;
    if (!isWindowBounds(value.bounds) || typeof value.maximized !== 'boolean') return null;
    return { bounds: value.bounds, maximized: value.maximized };
  } catch {
    return null;
  }
}

export function saveWindowState(filePath: string, state: SavedWindowState): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Window persistence must never prevent the application from closing.
  }
}

function intersectionSize(a: WindowBounds, b: WindowBounds): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

export function isWindowVisible(bounds: WindowBounds, displayWorkAreas: WindowBounds[]): boolean {
  return displayWorkAreas.some((workArea) => {
    const intersection = intersectionSize(bounds, workArea);
    return intersection.width >= 100 && intersection.height >= 100;
  });
}
