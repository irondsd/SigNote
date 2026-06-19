/**
 * Reflects the open note's id in the URL (`?id=…`) without a navigation, so a
 * refresh or shared link reopens it. Used by every tier's grid.
 */
export function setNoteIdParam(id: string) {
  window.history.replaceState(null, '', `${window.location.pathname}?id=${id}`);
}

export function clearNoteIdParam() {
  window.history.replaceState(null, '', window.location.pathname);
}
