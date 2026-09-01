import type { DesktopAuthCallback } from './ipc.js';

export class AuthCallbackQueue {
  private pending: DesktopAuthCallback | null = null;
  private rendererReady = false;

  receive(callback: DesktopAuthCallback): void {
    this.pending = callback;
  }

  markRendererLoading(): void {
    this.rendererReady = false;
  }

  markRendererReady(): void {
    this.rendererReady = true;
  }

  flush(deliver: (callback: DesktopAuthCallback) => void): boolean {
    if (!this.rendererReady || !this.pending) return false;
    const callback = this.pending;
    this.pending = null;
    deliver(callback);
    return true;
  }
}

export type FocusableDesktopWindow = {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
};

export function focusDesktopWindow(window: FocusableDesktopWindow | null): void {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
