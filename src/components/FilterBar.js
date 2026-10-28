import React, { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Star, X } from 'lucide-react-native';
import { ScrollView, Text } from '../ui';
import { MOODS } from '../theme';
import { EMPTY_FILTERS, hasActiveFilters } from '../utils/filters';

export { EMPTY_FILTERS, hasActiveFilters, applyFilters } from '../utils/filters';

function Chip({ selected, onPress, children, c, label }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[
        s.chip,
        {
          backgroundColor: selected ? c.sage : c.card,
          borderColor: selected ? c.sageDark : c.line,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

export default function FilterBar({ filters, setFilters, tags, t, c, rtl }) {
  const active = hasActiveFilters(filters);
  const toggle = (patch) => setFilters({ ...filters, ...patch });
  const usedTags = tags.filter((x) => x.count > 0);
  const scroller = useRef(null);
  return (
    <View style={s.wrap}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        // RTL: chips start at the RIGHT edge (flexGrow makes a short row fill the width,
        // and long rows open scrolled to their start, which is the right end).
        contentContainerStyle={[s.row, rtl && s.rowReverse]}
        onContentSizeChange={() => {
          if (rtl) scroller.current?.scrollToEnd?.({ animated: false });
        }}
      >
        <Chip c={c} selected={!active} onPress={() => setFilters(EMPTY_FILTERS)} label={t.allEntries}>
          <Text style={[s.chipText, { color: !active ? c.sageDark : c.muted }]}>{t.allEntries}</Text>
        </Chip>
        <Chip c={c} selected={filters.favorites} onPress={() => toggle({ favorites: !filters.favorites })} label={t.favorites}>
          <Star size={12} color={filters.favorites ? c.sageDark : c.muted} fill={filters.favorites ? c.sageDark : 'transparent'} />
          <Text style={[s.chipText, { color: filters.favorites ? c.sageDark : c.muted }]}>{t.favorites}</Text>
        </Chip>
        {MOODS.map((m) => (
          <Chip
            key={m.key}
            c={c}
            selected={filters.mood === m.key}
            onPress={() => toggle({ mood: filters.mood === m.key ? null : m.key })}
            label={t[m.key]}
          >
            <Text style={{ fontSize: 14 }}>{m.face}</Text>
          </Chip>
        ))}
        {usedTags.map((tag) => (
          <Chip
            key={tag.id}
            c={c}
            selected={filters.tagId === tag.id}
            onPress={() => toggle({ tagId: filters.tagId === tag.id ? null : tag.id })}
            label={`${t.tags}: ${tag.name}`}
          >
            <Text style={[s.chipText, { color: filters.tagId === tag.id ? c.sageDark : c.muted }]}>#{tag.name}</Text>
          </Chip>
        ))}
        {active ? (
          <Chip c={c} selected={false} onPress={() => setFilters(EMPTY_FILTERS)} label={t.clearFilters}>
            <X size={12} color={c.muted} />
            <Text style={[s.chipText, { color: c.muted }]}>{t.clearFilters}</Text>
          </Chip>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 11 },
  row: { flexDirection: 'row', gap: 7, paddingVertical: 2, flexGrow: 1 },
  rowReverse: { flexDirection: 'row-reverse' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 99,
    paddingVertical: 7,
    paddingHorizontal: 11,
    minHeight: 34,
  },
  chipText: { fontSize: 11, fontWeight: '600' },
});
