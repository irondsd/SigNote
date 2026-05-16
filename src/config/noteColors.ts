export const NOTE_COLORS = ['yellow', 'red', 'blue', 'green', 'clay', 'purple', 'teal', 'peach', 'gray'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const NOTE_PATTERNS = ['plain', 'grid', 'dots', 'stars', 'hatch', 'blobs'] as const;
export type NotePattern = (typeof NOTE_PATTERNS)[number];
