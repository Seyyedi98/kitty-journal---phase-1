import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Crosshair, MapPin, X } from 'lucide-react-native';
import { Text, TextInput } from '../ui';

/**
 * Optional place for an entry. `value` = null | { name, address, latitude, longitude }.
 * Typing a name never needs permission; "use current location" asks for it only
 * when tapped and never tracks anything in the background.
 */
export default function PlaceField({ value, onChange, onUseCurrent, locating, message, t, c, rtl }) {
  const name = value?.name || '';
  const hasCoords = value && value.latitude != null && value.longitude != null;
  const align = rtl ? 'right' : 'left';
  return (
    <View style={{ gap: 8 }}>
      <View style={[s.inputRow, { backgroundColor: c.card, borderColor: c.line }, rtl && s.rowReverse]}>
        <MapPin size={16} color={c.muted} />
        <TextInput
          value={name}
          onChangeText={(text) =>
            onChange({
              name: text,
              address: value?.address || '',
              latitude: value?.latitude ?? null,
              longitude: value?.longitude ?? null,
            })
          }
          placeholder={t.placeNamePlaceholder}
          placeholderTextColor={c.muted}
          style={[s.input, { color: c.ink, textAlign: align }]}
          accessibilityLabel={t.placeName}
        />
        {value ? (
          <Pressable onPress={() => onChange(null)} style={s.clear} accessibilityRole="button" accessibilityLabel={t.clearPlace} hitSlop={8}>
            <X size={16} color={c.muted} />
          </Pressable>
        ) : null}
      </View>

      <Pressable
        onPress={onUseCurrent}
        disabled={locating}
        accessibilityRole="button"
        style={[s.action, { borderColor: c.sageDark, backgroundColor: c.accentSoft, opacity: locating ? 0.7 : 1 }, rtl && s.rowReverse]}
      >
        {locating ? <ActivityIndicator size="small" color={c.sageDark} /> : <Crosshair size={15} color={c.sageDark} />}
        <Text style={{ color: c.sageDark, fontSize: 11, fontWeight: '700' }}>
          {locating ? t.fetchingLocation : t.useCurrentLocation}
        </Text>
      </Pressable>

      {value && (value.address || hasCoords) ? (
        <Text style={{ color: c.muted, fontSize: 10, textAlign: align }}>
          {value.address ? `${value.address} · ` : ''}
          {hasCoords ? t.placeCoordsSaved : t.placeNameOnly}
        </Text>
      ) : null}
      {message ? <Text style={{ color: c.danger, fontSize: 10, textAlign: align }}>{message}</Text> : null}
      <Text style={{ color: c.muted, fontSize: 10, lineHeight: 15, textAlign: align }}>{t.placeHint}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  rowReverse: { flexDirection: 'row-reverse' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, minHeight: 42 },
  input: { flex: 1, minWidth: 0, paddingVertical: 9, fontSize: 12 },
  clear: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 11, paddingVertical: 10, minHeight: 42 },
});
