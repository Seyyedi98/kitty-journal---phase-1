import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ImageOff, Image as ImageIcon, Map as MapIcon, MapPin } from 'lucide-react-native';
import { ScrollView, Text } from '../ui';
import EmptyState from '../components/EmptyState';
import PhotoViewer from '../components/PhotoViewer';
import PlacesMap from '../components/PlacesMap';
import { groupPlaces } from '../utils/mapPlaces';
import { listAllAttachments, listLocations } from '../db/repository';
import { attachmentUri } from '../services/photos';
import { deps } from '../platform/deps';
import { formatDateKey } from '../calendar';
import { geoUrl, numberFormatter, webMapUrl } from '../utils/format';
import { fmt } from '../i18n';

const fs = deps.fs;
const GAP = 4;
const MAP_IMAGE_LIMIT = 80; // markers that get a photo thumbnail
const MAX_THUMB_BYTES = 400 * 1024;

function Cell({ photo, size, onPress, c }) {
  const [broken, setBroken] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={photo.entry_title || photo.journal_date}
      style={{ width: size, height: size, borderRadius: 10, overflow: 'hidden', backgroundColor: c.lavender, alignItems: 'center', justifyContent: 'center' }}
    >
      {broken ? (
        <ImageOff size={20} color={c.muted} />
      ) : (
        <Image
          source={{ uri: attachmentUri(fs, photo.thumb_name || photo.file_name) }}
          style={{ width: size, height: size }}
          onError={() => setBroken(true)}
          accessibilityIgnoresInvertColors
        />
      )}
    </Pressable>
  );
}

/** Memories: a photo grid and a list of places, built only from what the user saved. */
export default function MemoriesScreen({ db, t, c, rtl, language, calendar, refreshKey, onOpenEntry, insets }) {
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState('photos');
  const [photos, setPhotos] = useState(null);
  const [places, setPlaces] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);
  const [mapImages, setMapImages] = useState({});
  const [mapOffline, setMapOffline] = useState(false);
  const num = useMemo(() => numberFormatter(language), [language]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listAllAttachments(db), listLocations(db)])
      .then(([p, l]) => {
        if (cancelled) return;
        setPhotos(p);
        setPlaces(l);
      })
      .catch(() => {
        if (!cancelled) {
          setPhotos([]);
          setPlaces([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [db, refreshKey]);

  const { groups, withoutCoords } = useMemo(() => groupPlaces(places || []), [places]);
  const firstPhotoByEntry = useMemo(() => {
    const m = new Map();
    for (const p of photos || []) if (!m.has(p.entry_id)) m.set(p.entry_id, p);
    return m;
  }, [photos]);
  const selected = groups.find((g) => g.key === selectedKey) || null;

  // Small photo thumbnails for the map markers (read once, as base64 for the WebView).
  useEffect(() => {
    if (tab !== 'map' || !groups.length || photos === null) return undefined;
    let cancelled = false;
    (async () => {
      const out = {};
      for (const g of groups.slice(0, MAP_IMAGE_LIMIT)) {
        const withPhoto = g.entries.map((e) => firstPhotoByEntry.get(e.entry_id)).find(Boolean);
        if (!withPhoto) continue;
        try {
          const uri = attachmentUri(fs, withPhoto.thumb_name || withPhoto.file_name);
          const size = await fs.size(uri);
          if (!size || size > MAX_THUMB_BYTES) continue;
          out[g.key] = `data:image/jpeg;base64,${await fs.readBase64(uri)}`;
        } catch {
          /* no photo marker for this place; a pin is drawn instead */
        }
      }
      if (!cancelled) setMapImages(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, groups, photos, firstPhotoByEntry]);

  const cols = width >= 900 ? 6 : width >= 600 ? 5 : 3;
  const usable = Math.min(width, 1060) - (width >= 600 ? 88 : 0) - (width >= 600 ? 60 : 38);
  const size = Math.floor((usable - GAP * (cols - 1)) / cols);

  const dateText = (key) => formatDateKey(key, language, calendar, { dateStyle: 'medium' });

  const openMaps = async (place) => {
    if (place.latitude == null || place.longitude == null) return;
    const label = place.name || place.address || '';
    try {
      const primary = geoUrl(place.latitude, place.longitude, label);
      if (await Linking.canOpenURL(primary)) await Linking.openURL(primary);
      else await Linking.openURL(webMapUrl(place.latitude, place.longitude));
    } catch {
      Alert.alert(t.openInMaps, t.mapsUnavailable);
    }
  };

  const tabs = [
    ['photos', t.memoriesImages, ImageIcon],
    ['map', t.memoriesMap, MapIcon],
    ['places', t.memoriesPlaces, MapPin],
  ];

  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={[s.eyebrow, { color: c.muted }]}>{t.memories}</Text>
      <Text style={[s.title, { color: c.ink }]}>{t.memories}</Text>

      <View style={[s.tabs, { backgroundColor: c.card, borderColor: c.line }, rtl && s.rowReverse]}>
        {tabs.map(([key, label, Icon]) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[s.tab, active && { backgroundColor: c.sage }, rtl && s.rowReverse]}
            >
              <Icon size={16} color={active ? c.sageDark : c.muted} />
              <Text style={{ color: active ? c.sageDark : c.muted, fontWeight: active ? '700' : '500', fontSize: 12 }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'photos' ? (
        photos === null ? (
          <Text style={{ color: c.muted, fontSize: 12 }}>{t.loading}</Text>
        ) : photos.length === 0 ? (
          <EmptyState c={c} title={t.noPhotos} hint={t.noPhotosHint} icon={ImageIcon} />
        ) : (
          <>
            <Text style={{ color: c.muted, fontSize: 11, textAlign: rtl ? 'right' : 'left' }}>
              {fmt(t.photoCount, { n: num(photos.length) })}
            </Text>
            <View style={[s.grid, { gap: GAP }, rtl && s.rowReverse]}>
              {photos.map((p, i) => (
                <Cell key={p.id} photo={p} size={size} c={c} onPress={() => setViewer(i)} />
              ))}
            </View>
          </>
        )
      ) : tab === 'map' ? (
        places === null ? (
          <Text style={{ color: c.muted, fontSize: 12 }}>{t.loading}</Text>
        ) : groups.length === 0 ? (
          <EmptyState c={c} title={t.mapEmpty} hint={t.mapEmptyHint} icon={MapPin} />
        ) : (
          <>
            <PlacesMap
              groups={groups}
              images={mapImages}
              background={c.line}
              accent={c.accent}
              offlineText={t.mapOffline}
              onSelect={setSelectedKey}
              onDeselect={() => setSelectedKey(null)}
              onOffline={() => setMapOffline(true)}
            />
            <Pressable onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => {})} accessibilityRole="link">
              <Text style={{ color: c.muted, fontSize: 9, textAlign: rtl ? 'right' : 'left' }}>{t.mapAttribution}</Text>
            </Pressable>
            {mapOffline ? <Text style={{ color: c.muted, fontSize: 11, textAlign: rtl ? 'right' : 'left' }}>{t.mapOffline}</Text> : null}
            {withoutCoords ? (
              <Text style={{ color: c.muted, fontSize: 10, textAlign: rtl ? 'right' : 'left' }}>{fmt(t.mapNoCoords, { n: num(withoutCoords) })}</Text>
            ) : null}
            {selected ? (
              <View style={[s.placeCard, { backgroundColor: c.card, borderColor: c.line }]}>
                <View style={[s.placeTop, rtl && s.rowReverse]}>
                  <View style={[s.pin, { backgroundColor: c.sage }]}>
                    <MapPin size={16} color={c.sageDark} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.ink, fontSize: 14, fontWeight: '600', textAlign: rtl ? 'right' : 'left' }}>
                      {selected.name || t.placeNameOnly}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 10, marginTop: 3, textAlign: rtl ? 'right' : 'left' }}>
                      {fmt(t.mapEntriesHere, { n: num(selected.entries.length) })}
                    </Text>
                  </View>
                  <Pressable onPress={() => openMaps({ latitude: selected.latitude, longitude: selected.longitude, name: selected.name })} accessibilityRole="button" style={[s.pill, { borderColor: c.sageDark, backgroundColor: c.accentSoft }]}>
                    <Text style={{ color: c.sageDark, fontSize: 11, fontWeight: '700' }}>{t.openInMaps}</Text>
                  </Pressable>
                </View>
                {selected.entries.map((e) => {
                  const photo = firstPhotoByEntry.get(e.entry_id);
                  return (
                    <Pressable
                      key={e.entry_id}
                      onPress={() => onOpenEntry(e.entry_id)}
                      accessibilityRole="button"
                      style={[s.entryRow, { borderColor: c.line }, rtl && s.rowReverse]}
                    >
                      {photo ? (
                        <Image source={{ uri: attachmentUri(fs, photo.thumb_name || photo.file_name) }} style={s.entryThumb} accessibilityIgnoresInvertColors />
                      ) : (
                        <View style={[s.entryThumb, { backgroundColor: c.sage, alignItems: 'center', justifyContent: 'center' }]}>
                          <MapPin size={16} color={c.sageDark} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: c.ink, fontSize: 13, fontWeight: '600', textAlign: rtl ? 'right' : 'left' }}>
                          {e.title || t.noTitle}
                        </Text>
                        <Text style={{ color: c.muted, fontSize: 10, marginTop: 2, textAlign: rtl ? 'right' : 'left' }}>{dateText(e.journal_date)}</Text>
                      </View>
                      <Text style={{ color: c.sageDark, fontSize: 11, fontWeight: '700' }}>{t.viewEntry}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={{ color: c.muted, fontSize: 11, textAlign: rtl ? 'right' : 'left' }}>{t.mapHint}</Text>
            )}
          </>
        )
      ) : places === null ? (
        <Text style={{ color: c.muted, fontSize: 12 }}>{t.loading}</Text>
      ) : places.length === 0 ? (
        <EmptyState c={c} title={t.noPlaces} hint={t.noPlacesHint} icon={MapPin} />
      ) : (
        <>
          <Text style={{ color: c.muted, fontSize: 10, lineHeight: 15, textAlign: rtl ? 'right' : 'left' }}>{t.placesNote}</Text>
          {places.map((p) => {
            const hasCoords = p.latitude != null && p.longitude != null;
            return (
              <View key={p.id} style={[s.placeCard, { backgroundColor: c.card, borderColor: c.line }]}>
                <View style={[s.placeTop, rtl && s.rowReverse]}>
                  <View style={[s.pin, { backgroundColor: c.sage }]}>
                    <MapPin size={16} color={c.sageDark} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.ink, fontSize: 14, fontWeight: '600', textAlign: rtl ? 'right' : 'left' }}>
                      {p.name || p.address || t.placeNameOnly}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 10, marginTop: 3, textAlign: rtl ? 'right' : 'left' }}>
                      {dateText(p.journal_date)}
                      {p.entry_title ? ` · ${p.entry_title}` : ''}
                    </Text>
                    {p.name && p.address ? (
                      <Text style={{ color: c.muted, fontSize: 10, marginTop: 2, textAlign: rtl ? 'right' : 'left' }}>{p.address}</Text>
                    ) : null}
                  </View>
                </View>
                <View style={[s.placeActions, rtl && s.rowReverse]}>
                  <Pressable onPress={() => onOpenEntry(p.entry_id)} accessibilityRole="button" style={[s.pill, { borderColor: c.line }]}>
                    <Text style={{ color: c.ink, fontSize: 11, fontWeight: '600' }}>{t.viewEntry}</Text>
                  </Pressable>
                  {hasCoords ? (
                    <Pressable onPress={() => openMaps(p)} accessibilityRole="button" style={[s.pill, { borderColor: c.sageDark, backgroundColor: c.accentSoft }]}>
                      <Text style={{ color: c.sageDark, fontSize: 11, fontWeight: '700' }}>{t.openInMaps}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </>
      )}

      <PhotoViewer
        visible={viewer !== null}
        photos={(photos || []).map((p) => ({
          id: p.id,
          uri: attachmentUri(fs, p.file_name),
          title: p.entry_title || '',
          subtitle: dateText(p.journal_date),
          entryId: p.entry_id,
        }))}
        index={viewer ?? 0}
        onClose={() => setViewer(null)}
        onOpenEntry={(p) => {
          setViewer(null);
          onOpenEntry(p.entryId);
        }}
        t={t}
        insets={insets}
        num={num}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { paddingTop: 25, paddingBottom: 110, gap: 14 },
  rowReverse: { flexDirection: 'row-reverse' },
  eyebrow: { fontSize: 10, letterSpacing: 1.6, fontWeight: '700', marginBottom: 9 },
  title: { fontSize: 29, fontWeight: '500', marginTop: -4, marginBottom: 6 },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 13, padding: 5 },
  tab: { flex: 1, minHeight: 40, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  placeCard: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 12 },
  placeTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  pin: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  placeActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, paddingTop: 10 },
  entryThumb: { width: 44, height: 44, borderRadius: 10 },
  pill: { borderWidth: 1, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 13, minHeight: 38, justifyContent: 'center' },
});
