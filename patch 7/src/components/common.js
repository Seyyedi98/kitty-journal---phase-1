import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import { ArrowLeft, ArrowRight } from 'lucide-react-native';
import { Text } from '../ui';

/** Header of a sub-screen (Backup, Trash, …) with a back button. */
export function SubHeader({ title, onBack, c, rtl, t, right }) {
  const Back = rtl ? ArrowRight : ArrowLeft;
  return (
    <View style={[s.subHeader, rtl && s.rowReverse]}>
      <Pressable onPress={onBack} style={[s.backBtn, { backgroundColor: c.card, borderColor: c.line }]} accessibilityRole="button" accessibilityLabel={t.back}>
        <Back size={18} color={c.ink} />
      </Pressable>
      <Text style={[s.subTitle, { color: c.ink, textAlign: rtl ? 'right' : 'left' }]} numberOfLines={1}>
        {title}
      </Text>
      {right || null}
    </View>
  );
}

/** Rounded section container with an optional title. */
export function Card({ title, children, c, rtl, style }) {
  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }, style]}>
      {title ? (
        <Text style={[s.cardTitle, { color: c.ink, textAlign: rtl ? 'right' : 'left' }]}>{title}</Text>
      ) : null}
      {children}
    </View>
  );
}

export function Note({ children, c, rtl, tone, style }) {
  return (
    <Text
      style={[
        s.note,
        { color: tone === 'danger' ? c.danger : tone === 'ok' ? c.sageDark : c.muted, textAlign: rtl ? 'right' : 'left' },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** variant: primary | secondary | danger */
export function Button({ label, onPress, c, rtl, variant = 'secondary', icon: Icon, disabled, busy, style }) {
  const primary = variant === 'primary';
  const danger = variant === 'danger';
  const fg = primary ? c.onAccent : danger ? c.danger : c.sageDark;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy) }}
      style={[
        s.button,
        {
          backgroundColor: primary ? c.accent : 'transparent',
          borderColor: primary ? c.accent : danger ? c.danger : c.sageDark,
          opacity: disabled ? 0.5 : 1,
        },
        rtl && s.rowReverse,
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : Icon ? <Icon size={16} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700', flexShrink: 1, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

/** A tappable row: icon · title/subtitle · trailing element. */
export function LinkRow({ icon: Icon, title, subtitle, onPress, trailing, c, rtl, last }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[s.linkRow, { borderBottomColor: c.line, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }, rtl && s.rowReverse]}
    >
      {Icon ? (
        <View style={[s.linkIcon, { backgroundColor: c.sage }]}>
          <Icon size={16} color={c.sageDark} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.ink, fontSize: 13, fontWeight: '600', textAlign: rtl ? 'right' : 'left' }}>{title}</Text>
        {subtitle ? (
          <Text style={{ color: c.muted, fontSize: 10, marginTop: 2, lineHeight: 15, textAlign: rtl ? 'right' : 'left' }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing || null}
    </Pressable>
  );
}

export function ToggleRow({ title, subtitle, value, onValueChange, c, rtl, disabled }) {
  return (
    <View style={[s.linkRow, { borderBottomWidth: 0 }, rtl && s.rowReverse]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.ink, fontSize: 13, fontWeight: '600', textAlign: rtl ? 'right' : 'left' }}>{title}</Text>
        {subtitle ? (
          <Text style={{ color: c.muted, fontSize: 10, marginTop: 2, lineHeight: 15, textAlign: rtl ? 'right' : 'left' }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: c.line, true: c.sageDark }}
        thumbColor={c.card}
        accessibilityLabel={title}
      />
    </View>
  );
}

/** Single-select pill group. options: [{ value, label }] */
export function Segmented({ options, value, onChange, c, rtl }) {
  return (
    <View style={[s.segRow, rtl && s.rowReverse]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[
              s.segment,
              { backgroundColor: selected ? c.accentSoft : c.paper, borderColor: selected ? c.sageDark : c.line },
            ]}
          >
            <Text style={{ color: selected ? c.sageDark : c.ink, fontSize: 11, fontWeight: '600' }}>{o.label}</Text>
            {selected ? <Text style={{ color: c.sageDark, fontSize: 11 }}>✓</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  rowReverse: { flexDirection: 'row-reverse' },
  subHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  backBtn: { width: 40, height: 40, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  subTitle: { flex: 1, fontSize: 22, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12, marginTop: 12 },
  cardTitle: { fontSize: 13, fontWeight: '700' },
  note: { fontSize: 11, lineHeight: 17 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, minHeight: 44 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 52 },
  linkIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  segment: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, minHeight: 38 },
});
