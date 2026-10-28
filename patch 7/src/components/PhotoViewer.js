import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { X } from 'lucide-react-native';
import { ScrollView, Text } from '../ui';
import { fmt } from '../i18n';

/**
 * Full-screen, swipeable photo viewer.
 * photos: [{ id, uri, title?, subtitle? }]   (uri already resolved by the caller)
 */
export default function PhotoViewer({ visible, photos, index = 0, onClose, onOpenEntry, t, insets, num = String }) {
  const { width, height } = useWindowDimensions();
  const scroller = useRef(null);
  const [current, setCurrent] = useState(index);
  const [failed, setFailed] = useState({});

  useEffect(() => {
    if (!visible) return undefined;
    setCurrent(index);
    setFailed({});
    const id = setTimeout(() => scroller.current?.scrollTo({ x: index * width, animated: false }), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, index]);

  if (!photos || photos.length === 0) return null;
  const safeIndex = Math.min(current, photos.length - 1);
  const photo = photos[safeIndex];

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.root}>
        <ExpoStatusBar style="light" backgroundColor="#000000" />
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
        >
          {photos.map((p) => (
            <View key={p.id} style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
              {failed[p.id] ? (
                <Text style={s.missing}>{t.photoMissing}</Text>
              ) : (
                <Image
                  source={{ uri: p.uri }}
                  style={{ width, height: height * 0.8 }}
                  resizeMode="contain"
                  onError={() => setFailed((prev) => ({ ...prev, [p.id]: true }))}
                  accessibilityIgnoresInvertColors
                />
              )}
            </View>
          ))}
        </ScrollView>

        <View style={[s.top, { paddingTop: (insets?.top || 0) + 8 }]} pointerEvents="box-none">
          <Text style={s.counter}>{fmt(t.photoViewerOf, { i: num(safeIndex + 1), n: num(photos.length) })}</Text>
          <Pressable onPress={onClose} style={s.close} accessibilityRole="button" accessibilityLabel={t.close}>
            <X size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        {onOpenEntry && photo ? (
          <View style={[s.bottom, { paddingBottom: (insets?.bottom || 0) + 16 }]} pointerEvents="box-none">
            {photo.title ? <Text style={s.caption} numberOfLines={1}>{photo.title}</Text> : null}
            {photo.subtitle ? <Text style={s.subcaption}>{photo.subtitle}</Text> : null}
            <Pressable onPress={() => onOpenEntry(photo)} style={s.openEntry} accessibilityRole="button">
              <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 12 }}>{t.viewEntry}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: { color: '#FFFFFF', fontSize: 12, opacity: 0.9 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000066' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, gap: 6, alignItems: 'center' },
  caption: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  subcaption: { color: '#FFFFFFB3', fontSize: 11 },
  openEntry: { marginTop: 6, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12, backgroundColor: '#FFFFFF26', minHeight: 40, justifyContent: 'center' },
  missing: { color: '#FFFFFFB3', fontSize: 13, padding: 24, textAlign: 'center' },
});
