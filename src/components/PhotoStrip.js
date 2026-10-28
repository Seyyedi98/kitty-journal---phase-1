import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { ImagePlus, X } from 'lucide-react-native';
import { ScrollView, Text } from '../ui';

const SIZE = 78;

function Thumb({ photo, uri, onOpen, onRemove, c, t, rtl }) {
  const [broken, setBroken] = useState(false);
  return (
    <View style={s.thumbWrap}>
      <Pressable onPress={onOpen} accessibilityRole="imagebutton" accessibilityLabel={t.photos} style={[s.thumb, { backgroundColor: c.lavender, borderColor: c.line }]}>
        {broken ? (
          <Text style={{ color: c.muted, fontSize: 9, textAlign: 'center', padding: 4 }}>{t.photoMissing}</Text>
        ) : (
          <Image source={{ uri }} style={s.image} onError={() => setBroken(true)} accessibilityIgnoresInvertColors />
        )}
      </Pressable>
      <Pressable
        onPress={onRemove}
        style={[s.remove, { backgroundColor: c.card, borderColor: c.line }, rtl ? { left: -6 } : { right: -6 }]}
        accessibilityRole="button"
        accessibilityLabel={t.photoRemove}
        hitSlop={8}
      >
        <X size={12} color={c.ink} />
      </Pressable>
    </View>
  );
}

/** Horizontal strip of an entry's photos with an "add" tile. */
export default function PhotoStrip({ photos, uriFor, onAdd, onOpen, onRemove, busy, t, c, rtl }) {
  return (
    <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={[s.row, rtl && s.rowReverse]}>
      <Pressable
        onPress={onAdd}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t.addPhotos}
        style={[s.add, { borderColor: c.sageDark, backgroundColor: c.accentSoft, opacity: busy ? 0.6 : 1 }]}
      >
        {busy ? <ActivityIndicator color={c.sageDark} /> : <ImagePlus size={22} color={c.sageDark} />}
        <Text style={{ color: c.sageDark, fontSize: 10, fontWeight: '600', textAlign: 'center' }}>{t.addPhotos}</Text>
      </Pressable>
      {photos.map((p, i) => (
        <Thumb key={p.id} photo={p} uri={uriFor(p)} onOpen={() => onOpen(i)} onRemove={() => onRemove(p)} c={c} t={t} rtl={rtl} />
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  rowReverse: { flexDirection: 'row-reverse' },
  add: {
    width: SIZE,
    height: SIZE,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  thumbWrap: { width: SIZE, height: SIZE },
  thumb: { width: SIZE, height: SIZE, borderRadius: 14, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: SIZE, height: SIZE },
  remove: {
    position: 'absolute',
    top: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
