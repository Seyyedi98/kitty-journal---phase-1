import React from 'react';

// Generic component factory for icon libraries: every icon becomes <i data-icon="Name">.
const mk = (name) => function Icon() { return <i data-icon={name} />; };
export const iconProxy = { __esModule: true, ArrowLeft: mk('ArrowLeft'), ArrowRight: mk('ArrowRight'), BookOpen: mk('BookOpen'), ChevronLeft: mk('ChevronLeft'), ChevronRight: mk('ChevronRight'), Crosshair: mk('Crosshair'), Heart: mk('Heart'), Image: mk('Image'), ImageOff: mk('ImageOff'), ImagePlus: mk('ImagePlus'), MapPin: mk('MapPin'), PenLine: mk('PenLine'), Pencil: mk('Pencil'), Pin: mk('Pin'), Plus: mk('Plus'), RotateCcw: mk('RotateCcw'), RotateCw: mk('RotateCw'), Search: mk('Search'), Settings2: mk('Settings2'), Smile: mk('Smile'), Sparkles: mk('Sparkles'), Star: mk('Star'), Tag: mk('Tag'), Trash2: mk('Trash2'), X: mk('X') };

export const reanimated = {
  __esModule: true,
  default: { View: ({ children, style }) => <div style={{ display: 'flex', flexDirection: 'column' }}>{children}</div> },
  FadeInDown: { duration: () => ({ delay: () => ({}) }), delay: () => ({ duration: () => ({}) }) },
};
