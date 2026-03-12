export const NOTE_COLORS = ['yellow', 'red', 'blue', 'green', 'clay', 'gray'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const SWITCH_COLORS: Record<NoteColor, string> = {
  yellow: '#FFD54F',
  red: '#F28B82',
  blue: '#90CAF9',
  green: '#81C995',
  clay: '#E6B8A2',
  gray: '#BDBDBD',
};
