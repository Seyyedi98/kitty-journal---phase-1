export const MOODS = [
  { key: 'veryLow', face: '😿', color: '#E9D5D1' },
  { key: 'low', face: '🙁', color: '#F1E0CF' },
  { key: 'okay', face: '😐', color: '#F4EBCF' },
  { key: 'good', face: '🙂', color: '#DCE9D8' },
  { key: 'great', face: '😸', color: '#D5E8D9' },
];

export const BASE = {
  ink: '#38352F',
  muted: '#898276',
  paper: '#FBF8F0',
  card: '#FFFDF8',
  line: '#EAE3D5',
  sage: '#DCE6D7',
  sageDark: '#6F8668',
  rose: '#EAD0C6',
  lavender: '#E8E0ED',
  bg: '#F5F0E7',
  cream: '#FBF8F0',
  dockBorder: '#E8DFD1',
  brown: '#8B5A2B',
  accent: '#778B6D',
  accentSoft: '#F1F3EB',
  write: '#F8EEE5',
  white: '#FFFFFF',
  danger: '#B64E45',
  star: '#B78E57',
  onAccent: '#FFFFFF',
};

export const DARK = {
  ink: '#EEE8DC',
  muted: '#B5AA98',
  paper: '#242722',
  card: '#2D3029',
  line: '#45473D',
  sage: '#394236',
  sageDark: '#B4C5A6',
  rose: '#514239',
  lavender: '#48404C',
  bg: '#1C1F1A',
  cream: '#282B25',
  dockBorder: '#41443B',
  brown: '#9E7951',
  accent: '#B4C5A6',
  accentSoft: '#2C332A',
  write: '#382F2A',
  white: '#FFFFFF',
  danger: '#E08A80',
  star: '#D4AE78',
  // Text/icons drawn ON the accent color (the dark accent is pale, so white is unreadable).
  onAccent: '#1C1F1A',
};

/* ------------------------------- themes ------------------------------- */
// A theme overrides only colors; layout and typography never change. The
// default "sage" theme is BASE/DARK exactly as designed.

export const THEMES = {
  sage: { light: {}, dark: {} },
  rose: {
    light: {
      sage: '#F0DAD6', sageDark: '#8A4B45', accent: '#9A5750', accentSoft: '#F7EDEB', write: '#F7ECE6',
      rose: '#EAD0C6', paper: '#FCF7F4', card: '#FFFBF9', line: '#EBDDD6', bg: '#F6EEEA', cream: '#FCF7F4',
      muted: '#7A6E69', dockBorder: '#EBDDD6',
    },
    dark: {
      sage: '#4A3532', sageDark: '#E8B8B0', accent: '#E8B8B0', accentSoft: '#35282A', write: '#3A2C2C',
      paper: '#2A2224', card: '#342A2C', line: '#4F4144', bg: '#211B1C', cream: '#2A2224',
      muted: '#BDAFAA', dockBorder: '#4F4144',
    },
  },
  lavender: {
    light: {
      sage: '#E4DDF0', sageDark: '#5E4B86', accent: '#6B5A93', accentSoft: '#F1EEF6', write: '#F2ECF4',
      paper: '#FAF8FC', card: '#FFFDFF', line: '#E3DDEB', bg: '#F3EFF7', cream: '#FAF8FC',
      muted: '#746C80', dockBorder: '#E3DDEB',
    },
    dark: {
      sage: '#3E3750', sageDark: '#CBBFE8', accent: '#CBBFE8', accentSoft: '#302B3B', write: '#352F40',
      paper: '#26232D', card: '#2F2B38', line: '#463F55', bg: '#1E1C24', cream: '#26232D',
      muted: '#B8B0C4', dockBorder: '#463F55',
    },
  },
  ocean: {
    light: {
      sage: '#D8E8EC', sageDark: '#2F6674', accent: '#33707F', accentSoft: '#EAF3F5', write: '#EBF2F2',
      paper: '#F6FAFA', card: '#FDFFFF', line: '#D6E3E6', bg: '#EEF4F5', cream: '#F6FAFA',
      muted: '#667579', dockBorder: '#D6E3E6',
    },
    dark: {
      sage: '#2F4348', sageDark: '#9CCBD6', accent: '#9CCBD6', accentSoft: '#26343A', write: '#2B3A3E',
      paper: '#20292C', card: '#273236', line: '#3B4D52', bg: '#192023', cream: '#20292C',
      muted: '#A9BCC1', dockBorder: '#3B4D52',
    },
  },
};

export const THEME_KEYS = Object.keys(THEMES);
export const DEFAULT_THEME = 'sage';

/** Resolved palette for a theme + light/dark. Unknown themes fall back to default. */
export function buildPalette(themeKey, dark) {
  const base = dark ? DARK : BASE;
  const theme = THEMES[themeKey] || THEMES[DEFAULT_THEME];
  return { ...base, ...(dark ? theme.dark : theme.light) };
}

/** WCAG 2.x contrast ratio between two #RRGGBB colors. */
export function contrastRatio(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
