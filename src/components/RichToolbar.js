import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Bold, Heading1, Heading2, Highlighter, Italic, List, ListOrdered, Palette, PilcrowLeft, PilcrowRight, Redo2, Strikethrough, Type, Underline, Undo2, X,
} from 'lucide-react-native';
import { ScrollView, Text } from '../ui';
import { PressableScale } from '../motion';

// Mid-tone colours that stay readable on both the light and the dark theme.
export const TEXT_COLORS = [
  { hex: '#d6453d', key: 'colorRed' },
  { hex: '#e07b20', key: 'colorOrange' },
  { hex: '#3e9b5a', key: 'colorGreen' },
  { hex: '#3b7dd8', key: 'colorBlue' },
  { hex: '#8a5cc7', key: 'colorPurple' },
  { hex: '#d6538f', key: 'colorPink' },
  { hex: '#8b5a2b', key: 'colorBrown' },
  { hex: '#7a7a7a', key: 'colorGray' },
];

export const HIGHLIGHTS = [
  { value: 'rgba(255,213,79,0.45)', key: 'hlYellow' },
  { value: 'rgba(129,199,132,0.4)', key: 'hlGreen' },
  { value: 'rgba(100,181,246,0.4)', key: 'hlBlue' },
  { value: 'rgba(244,143,177,0.4)', key: 'hlPink' },
  { value: 'rgba(255,167,38,0.4)', key: 'hlOrange' },
  { value: 'rgba(186,104,200,0.35)', key: 'hlPurple' },
];

// Fonts that exist on every phone, so entries look the same offline and after a restore.
export const FONTS = [
  { id: '', key: 'fontDefault', family: undefined },
  { id: 'serif', key: 'fontSerif', family: 'serif' },
  { id: 'naskh', key: 'fontNaskh', family: 'serif' },
  { id: 'mono', key: 'fontMono', family: 'monospace' },
  { id: 'hand', key: 'fontHand', family: undefined },
];

const GROUPS = [
  [
    { cmd: 'undo', Icon: Undo2, key: 'fmtUndo', enabled: 'canUndo' },
    { cmd: 'redo', Icon: Redo2, key: 'fmtRedo', enabled: 'canRedo' },
  ],
  [
    { cmd: 'bold', Icon: Bold, key: 'fmtBold', state: 'bold' },
    { cmd: 'italic', Icon: Italic, key: 'fmtItalic', state: 'italic' },
    { cmd: 'underline', Icon: Underline, key: 'fmtUnderline', state: 'underline' },
    { cmd: 'strike', Icon: Strikethrough, key: 'fmtStrike', state: 'strike' },
  ],
  [
    { cmd: 'h1', Icon: Heading1, key: 'fmtH1', block: 'h1' },
    { cmd: 'h2', Icon: Heading2, key: 'fmtH2', block: 'h2' },
  ],
  [
    { cmd: 'ul', Icon: List, key: 'fmtBullets', list: 'ul' },
    { cmd: 'ol', Icon: ListOrdered, key: 'fmtNumbered', list: 'ol' },
  ],
  [
    { cmd: 'ltr', Icon: PilcrowRight, key: 'fmtLtr', dir: 'ltr' },
    { cmd: 'rtl', Icon: PilcrowLeft, key: 'fmtRtl', dir: 'rtl' },
  ],
];

/**
 * Formatting bar. Always left-to-right on purpose: the icons are universal and
 * a fixed order keeps muscle memory across languages.
 */
export default function RichToolbar({ t, c, state = {}, onCommand, bottomInset = 0 }) {
  const [panel, setPanel] = useState(null); // null | 'color' | 'highlight' | 'font'
  const current = state.color || '';
  const hl = (state.highlight || '').toLowerCase();
  const pick = (cmd, arg) => { onCommand(cmd, arg); setPanel(null); };
  const toggle = (name) => setPanel((p) => (p === name ? null : name));
  return (
    <View
      style={[s.bar, { backgroundColor: c.cream || c.card, borderTopColor: c.line, paddingBottom: bottomInset }]}
      accessibilityLabel={t.fmtToolbar}
    >
      {panel === 'color' ? (
        <View style={s.palette} testID="color-palette">
          <PressableScale
            testID="color-default"
            onPress={() => pick('color', '')}
            accessibilityRole="button"
            accessibilityLabel={t.fmtColorDefault}
            style={[s.swatch, { borderColor: c.line, backgroundColor: c.card }]}
          >
            <X size={15} color={c.muted} />
          </PressableScale>
          {TEXT_COLORS.map(({ hex, key }) => (
            <PressableScale
              key={hex}
              testID={`color-${hex.slice(1)}`}
              onPress={() => pick('color', hex)}
              accessibilityRole="button"
              accessibilityLabel={t[key]}
              accessibilityState={{ selected: current === hex }}
              style={[s.swatch, { backgroundColor: hex, borderColor: current === hex ? c.ink : 'transparent' }]}
            />
          ))}
        </View>
      ) : null}
      {panel === 'highlight' ? (
        <View style={s.palette} testID="highlight-palette">
          <PressableScale
            testID="highlight-none"
            onPress={() => pick('highlight', '')}
            accessibilityRole="button"
            accessibilityLabel={t.fmtHighlightNone}
            style={[s.swatch, { borderColor: c.line, backgroundColor: c.card }]}
          >
            <X size={15} color={c.muted} />
          </PressableScale>
          {HIGHLIGHTS.map(({ value, key }, i) => (
            <PressableScale
              key={value}
              testID={`highlight-${i}`}
              onPress={() => pick('highlight', value)}
              accessibilityRole="button"
              accessibilityLabel={t[key]}
              accessibilityState={{ selected: hl === value }}
              style={[s.swatch, { backgroundColor: value, borderColor: hl === value ? c.ink : c.line }]}
            />
          ))}
        </View>
      ) : null}
      {panel === 'font' ? (
        <View style={s.palette} testID="font-panel">
          {FONTS.map(({ id, key, family }) => {
            const on = (state.font || '') === id;
            return (
              <PressableScale
                key={id || 'default'}
                testID={`font-${id || 'default'}`}
                onPress={() => pick('font', id)}
                accessibilityRole="button"
                accessibilityLabel={t[key]}
                accessibilityState={{ selected: on }}
                style={[s.fontChip, { borderColor: on ? c.sageDark : c.line, backgroundColor: on ? c.sage : c.card }]}
              >
                <Text style={{ color: on ? c.sageDark : c.ink, fontSize: 13, fontFamily: family }}>{t[key]}</Text>
              </PressableScale>
            );
          })}
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={s.row}>
        {GROUPS.map((group, gi) => (
          <View key={gi} style={[s.group, gi > 0 && { borderLeftColor: c.line, borderLeftWidth: 1 }]}>
            {group.map(({ cmd, Icon, key, state: stateKey, block, list, dir, enabled }) => {
              const active = stateKey ? Boolean(state[stateKey]) : block ? state.block === block : list ? state.list === list : dir ? state.dir === dir : false;
              const disabled = enabled ? state[enabled] === false : false;
              return (
                <PressableScale
                  key={cmd}
                  testID={`fmt-${cmd}`}
                  onPress={() => onCommand(cmd)}
                  accessibilityRole="button"
                  accessibilityLabel={t[key]}
                  accessibilityState={{ selected: active, disabled }}
                  style={[s.btn, active && { backgroundColor: c.sage }, disabled && { opacity: 0.35 }]}
                >
                  <Icon size={19} color={active ? c.sageDark : c.muted} strokeWidth={active ? 2.6 : 2} />
                </PressableScale>
              );
            })}
          </View>
        ))}
        <View style={[s.group, { borderLeftColor: c.line, borderLeftWidth: 1 }]}>
          <PressableScale
            testID="fmt-font"
            onPress={() => toggle('font')}
            accessibilityRole="button"
            accessibilityLabel={t.fmtFont}
            accessibilityState={{ expanded: panel === 'font', selected: Boolean(state.font) }}
            style={[s.btn, (panel === 'font' || state.font) && { backgroundColor: c.sage }]}
          >
            <Type size={19} color={panel === 'font' || state.font ? c.sageDark : c.muted} />
          </PressableScale>
          <PressableScale
            testID="fmt-color"
            onPress={() => toggle('color')}
            accessibilityRole="button"
            accessibilityLabel={t.fmtColor}
            accessibilityState={{ expanded: panel === 'color', selected: Boolean(current) }}
            style={[s.btn, panel === 'color' && { backgroundColor: c.sage }]}
          >
            <Palette size={19} color={panel === 'color' ? c.sageDark : c.muted} />
            <View style={[s.dot, { backgroundColor: current || 'transparent' }]} />
          </PressableScale>
          <PressableScale
            testID="fmt-highlight"
            onPress={() => toggle('highlight')}
            accessibilityRole="button"
            accessibilityLabel={t.fmtHighlight}
            accessibilityState={{ expanded: panel === 'highlight', selected: Boolean(hl) }}
            style={[s.btn, panel === 'highlight' && { backgroundColor: c.sage }]}
          >
            <Highlighter size={19} color={panel === 'highlight' ? c.sageDark : c.muted} />
            <View style={[s.dot, { backgroundColor: hl || 'transparent' }]} />
          </PressableScale>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { borderTopWidth: 1, paddingTop: 6, paddingHorizontal: 8, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 8 },
  group: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 4 },
  btn: { width: 42, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  palette: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingTop: 2 },
  fontChip: { borderWidth: 1.5, borderRadius: 99, paddingVertical: 6, paddingHorizontal: 12 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', bottom: 5, width: 14, height: 3, borderRadius: 2 },
});
