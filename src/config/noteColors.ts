export const NOTE_COLORS = ['yellow', 'red', 'blue', 'green', 'clay', 'purple', 'teal', 'peach', 'gray'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const NOTE_PATTERNS = ['plain', 'grid', 'dots', 'stars', 'hatch', 'blobs'] as const;
export type NotePattern = (typeof NOTE_PATTERNS)[number];

type ColorDef = {
  hue: number;
  light: [number, number];
  dark: [number, number];
};

export const NOTE_COLOR_CONFIG: Record<NoteColor, ColorDef> = {
  yellow: { hue: 92, light: [0.97, 0.05], dark: [0.3, 0.07] },
  red: { hue: 20, light: [0.96, 0.025], dark: [0.28, 0.075] },
  blue: { hue: 235, light: [0.96, 0.028], dark: [0.27, 0.07] },
  green: { hue: 150, light: [0.97, 0.035], dark: [0.27, 0.06] },
  clay: { hue: 60, light: [0.96, 0.025], dark: [0.28, 0.05] },
  purple: { hue: 320, light: [0.96, 0.03], dark: [0.27, 0.065] },
  teal: { hue: 195, light: [0.96, 0.03], dark: [0.27, 0.055] },
  peach: { hue: 35, light: [0.96, 0.035], dark: [0.29, 0.065] },
  gray: { hue: 260, light: [0.97, 0.005], dark: [0.32, 0.005] },
};
