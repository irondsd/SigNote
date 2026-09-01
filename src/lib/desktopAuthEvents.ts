export type DesktopAuthUiEvent = { state: 'exchanging' } | { state: 'success' } | { state: 'error'; message: string };

const EVENT_NAME = 'signote:desktop-auth-state';

export function emitDesktopAuthUiEvent(detail: DesktopAuthUiEvent): void {
  window.dispatchEvent(new CustomEvent<DesktopAuthUiEvent>(EVENT_NAME, { detail }));
}

export function onDesktopAuthUiEvent(callback: (event: DesktopAuthUiEvent) => void): () => void {
  const listener = (event: Event) => callback((event as CustomEvent<DesktopAuthUiEvent>).detail);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
