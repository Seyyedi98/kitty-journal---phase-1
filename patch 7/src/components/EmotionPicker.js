import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui';
import { EMOTIONS } from '../utils/emotions';
import { fmt } from '../i18n';

/**
 * Secondary feelings. `value` = [{ key, intensity|null }].
 * Tap a feeling to toggle it; once selected, a 1–5 strength row appears
 * (tap the same number again to clear the strength).
 */
export default function EmotionPicker({ value, onChange, t, c, rtl, num = String }) {
  const byKey = new Map(value.map((e) => [e.key, e]));
  const toggle = (key) => {
    if (byKey.has(key)) onChange(value.filter((e) => e.key !== key));
    else onChange([...value, { key, intensity: null }]);
  };
  const setIntensity = (key, n) =>
    onChange(value.map((e) => (e.key === key ? { ...e, intensity: e.intensity === n ? null : n } : e)));

  return (
    <View style={{ gap: 8 }}>
      <View style={[s.chips, rtl && s.rowReverse]}>
        {EMOTIONS.map((em) => {
          const selected = byKey.has(em.key);
          return (
            <Pressable
              key={em.key}
              onPress={() => toggle(em.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                s.chip,
                { backgroundColor: selected ? c.sage : c.card, borderColor: selected ? c.sageDark : c.line },
                rtl && s.rowReverse,
              ]}
            >
              <Text style={{ fontSize: 14 }}>{em.face}</Text>
              <Text style={{ color: selected ? c.sageDark : c.muted, fontSize: 11, fontWeight: '600' }}>
                {t[`emotion_${em.key}`]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {value.map((e) => {
        const def = EMOTIONS.find((x) => x.key === e.key);
        if (!def) return null;
        return (
          <View key={e.key} style={[s.strengthRow, rtl && s.rowReverse]}>
            <Text style={{ color: c.ink, fontSize: 11, flex: 1 }}>
              {def.face} {t[`emotion_${e.key}`]}
            </Text>
            <View style={[s.dots, rtl && s.rowReverse]}>
              {[1, 2, 3, 4, 5].map((n) => {
                const filled = e.intensity != null && n <= e.intensity;
                return (
                  <Pressable
                    key={n}
                    onPress={() => setIntensity(e.key, n)}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel={fmt(t.intensityLevel, { n: num(n) })}
                    accessibilityState={{ selected: e.intensity === n }}
                    style={[s.dot, { backgroundColor: filled ? c.sageDark : 'transparent', borderColor: filled ? c.sageDark : c.line }]}
                  />
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  rowReverse: { flexDirection: 'row-reverse' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 99, paddingVertical: 7, paddingHorizontal: 11, minHeight: 34 },
  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  dots: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
});
