import { View as RNView, Text as RNText } from './rn.jsx';
import React from 'react';

// Generic component factory for icon libraries: every icon becomes <i data-icon="Name">.
const mk = (name) => function Icon() { return <i data-icon={name} />; };
export const iconProxy = { __esModule: true, Archive: mk('Archive'), ArrowLeft: mk('ArrowLeft'), ArrowRight: mk('ArrowRight'), Bold: mk('Bold'), BookOpen: mk('BookOpen'), CalendarDays: mk('CalendarDays'), ChartNoAxesColumn: mk('ChartNoAxesColumn'), ChevronLeft: mk('ChevronLeft'), ChevronRight: mk('ChevronRight'), Crosshair: mk('Crosshair'), Download: mk('Download'), FileText: mk('FileText'), Heading1: mk('Heading1'), Heading2: mk('Heading2'), Heart: mk('Heart'), Highlighter: mk('Highlighter'), Home: mk('Home'), Image: mk('Image'), ImageOff: mk('ImageOff'), ImagePlus: mk('ImagePlus'), Italic: mk('Italic'), List: mk('List'), ListOrdered: mk('ListOrdered'), Map: mk('Map'), MapPin: mk('MapPin'), Palette: mk('Palette'), PenLine: mk('PenLine'), Pencil: mk('Pencil'), PilcrowLeft: mk('PilcrowLeft'), PilcrowRight: mk('PilcrowRight'), Pin: mk('Pin'), Plus: mk('Plus'), Redo2: mk('Redo2'), RotateCcw: mk('RotateCcw'), RotateCw: mk('RotateCw'), Search: mk('Search'), Settings2: mk('Settings2'), Share2: mk('Share2'), Smile: mk('Smile'), Sparkles: mk('Sparkles'), Star: mk('Star'), Strikethrough: mk('Strikethrough'), Tag: mk('Tag'), Trash2: mk('Trash2'), Type: mk('Type'), Underline: mk('Underline'), Undo2: mk('Undo2'), X: mk('X') };

// Chainable no-op "layout animation" builder: FadeInDown.delay(1).duration(2) ...
const builder = () => new Proxy(function () {}, { get: (_t, k) => (k === '__esModule' ? false : builder), apply: () => builder() });
const Animated = {
  View: RNView,
  Text: RNText,
  createAnimatedComponent: (C) => C,
};
export const reanimated = {
  __esModule: true,
  default: Animated,
  Extrapolation: { CLAMP: 'clamp' },
  interpolate: (_v, _i, o) => o[o.length - 1],
  interpolateColor: (_v, _i, o) => o[o.length - 1],
  useSharedValue: (v) => ({ value: v }),
  useAnimatedStyle: (fn) => fn(),
  withSpring: (v) => v,
  withTiming: (v) => v,
  withDelay: (_d, v) => v,
  withSequence: (...v) => v[v.length - 1],
  FadeIn: builder(), FadeInDown: builder(), FadeOut: builder(), ZoomIn: builder(),
  SlideInDown: builder(), SlideOutDown: builder(), LinearTransition: builder(),
};
