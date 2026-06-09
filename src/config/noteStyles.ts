export const NOTE_COLORS = ['yellow', 'red', 'blue', 'green', 'rose', 'purple', 'teal', 'peach', 'gray'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const NOTE_PATTERNS = ['plain', 'grid', 'dots', 'stars', 'hatch', 'blobs'] as const;
export type NotePattern = (typeof NOTE_PATTERNS)[number];

// Tags reuse the note color palette — no separate palette / CSS variables.
export const TAG_COLORS = NOTE_COLORS;
export type TagColor = NoteColor;

// Deterministically map a tag name to one of the note colors. Used when a tag
// is created from the in-note picker (no explicit color); stable so the same
// name always lands on the same color until the user recolors it in the manager.
export function autoTagColor(name: string): TagColor {
  const normalized = name.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length];
}
