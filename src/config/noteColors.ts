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

// todo: add more and
// blue light #AECCDC dark #294255
// green light #E2F6D3 dark #254D3B
// sand light #FFF8B8 dark #7C4A02
// clay light #E9E3D4 dark #4B443B
// peach light #F39F76 dark #692B16
// purple light #D3BFDB dark #472E5B
