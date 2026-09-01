export function getDesktopBridge(): SigNoteDesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return window.signoteDesktop?.isDesktop === true ? window.signoteDesktop : null;
}

export function isDesktopApp(): boolean {
  return getDesktopBridge() !== null;
}
