import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Archive, ChevronLeft, ChevronRight, Heart, HardDrive, Tag, Trash2 } from 'lucide-react-native';
import { ScrollView, Text } from '../ui';
import { Card, LinkRow, Segmented } from '../components/common';
import { fmt } from '../i18n';

/**
 * Settings. `onOpen(name)` navigates to a sub-screen; the rows shown here are
 * the ones whose screens exist in this build.
 */
export default function SettingsScreen({
  t,
  c,
  rtl,
  language,
  changeLanguage,
  calendarType,
  changeCalendar,
  appearance,
  setAppearance,
  onOpen,
  trashCount = 0,
  num = String,
}) {
  const Chevron = rtl ? ChevronLeft : ChevronRight;
  const chevron = <Chevron size={16} color={c.muted} />;
  const align = rtl ? 'right' : 'left';
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={[s.eyebrow, { color: c.muted }]}>{t.settings}</Text>
      <Text style={[s.title, { color: c.ink }]}>{t.settings}</Text>

      <Card title={t.language} c={c} rtl={rtl}>
        <Segmented
          c={c}
          rtl={rtl}
          value={language}
          onChange={changeLanguage}
          options={[
            { value: 'en', label: 'English' },
            { value: 'fa', label: 'فارسی' },
            { value: 'tr', label: 'Türkçe' },
          ]}
        />
      </Card>

      <Card title={t.calendarType} c={c} rtl={rtl}>
        <Segmented
          c={c}
          rtl={rtl}
          value={calendarType}
          onChange={changeCalendar}
          options={[
            { value: 'solarHijri', label: t.solarHijri },
            { value: 'gregorian', label: t.gregorian },
            { value: 'default', label: t.languageDefault },
          ]}
        />
      </Card>

      <Card title={t.appearance} c={c} rtl={rtl}>
        <Segmented
          c={c}
          rtl={rtl}
          value={appearance}
          onChange={setAppearance}
          options={[
            { value: 'light', label: t.light },
            { value: 'dark', label: t.dark },
            { value: 'system', label: t.system },
          ]}
        />
      </Card>

      <Card title={t.settingsData} c={c} rtl={rtl} style={{ gap: 0 }}>
        <LinkRow icon={Archive} title={t.backup} onPress={() => onOpen('backup')} trailing={chevron} c={c} rtl={rtl} />
        <LinkRow icon={HardDrive} title={t.storage} onPress={() => onOpen('storage')} trailing={chevron} c={c} rtl={rtl} />
        <LinkRow
          icon={Trash2}
          title={t.trash}
          subtitle={trashCount ? fmt(t.trashCount, { n: num(trashCount) }) : t.trashEmpty}
          onPress={() => onOpen('trash')}
          trailing={chevron}
          c={c}
          rtl={rtl}
        />
        <LinkRow icon={Tag} title={t.manageTags} onPress={() => onOpen('tags')} trailing={chevron} c={c} rtl={rtl} last />
      </Card>

      <View style={[s.privacy, { backgroundColor: c.card, borderColor: c.line }, rtl && s.rowReverse]}>
        <Heart size={20} color={c.sageDark} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.ink, fontSize: 13, fontWeight: '700', textAlign: align }}>{t.privacyTitle}</Text>
          <Text style={{ color: c.muted, fontSize: 11, lineHeight: 17, marginTop: 5, textAlign: align }}>{t.privacyNote}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { paddingTop: 25, paddingBottom: 120, gap: 2 },
  rowReverse: { flexDirection: 'row-reverse' },
  eyebrow: { fontSize: 10, letterSpacing: 1.6, fontWeight: '700', marginBottom: 9 },
  title: { fontSize: 29, fontWeight: '500', marginTop: -4, marginBottom: 6 },
  privacy: { borderWidth: 1, borderRadius: 15, padding: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 14 },
});
