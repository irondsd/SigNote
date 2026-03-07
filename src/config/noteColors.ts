export const NOTE_COLORS = ['yellow', 'red', 'blue', 'green', 'clay', 'gray'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
