import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { RotateCcw, Trash2 } from 'lucide-react-native';
import { ScrollView, Text } from '../ui';
import EmptyState from '../components/EmptyState';
import { Button, Note, SubHeader } from '../components/common';
import { listDeletedEntries, restoreEntry } from '../db/repository';
import { emptyTrashAndFiles, purgeEntryAndFiles } from '../services/photos';
import { deps } from '../platform/deps';
import { formatDateKey } from '../calendar';
import { isoToDateKey, numberFormatter } from '../utils/format';
import { fmt } from '../i18n';

const fs = deps.fs;

export default function TrashScreen({ db, t, c, rtl, language, calendar, onBack, onChanged }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const num = useMemo(() => numberFormatter(language), [language]);

  const load = useCallback(async () => {
    try {
      setItems(await listDeletedEntries(db));
    } catch {
      setItems([]);
    }
  }, [db]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch {
      Alert.alert(t.somethingWrong, t.saveFailedHint);
    } finally {
      setBusy(false);
    }
  };

  const restore = (entry) => run(() => restoreEntry(db, entry.id));
  const purge = (entry) =>
    Alert.alert(t.deleteForever, t.deleteForeverConfirm, [
      { text: t.cancel, style: 'cancel' },
      { text: t.deleteForever, style: 'destructive', onPress: () => run(() => purgeEntryAndFiles(db, fs, entry.id)) },
    ]);
  const emptyAll = () =>
    Alert.alert(t.emptyTrash, t.emptyTrashConfirm, [
      { text: t.cancel, style: 'cancel' },
      { text: t.emptyTrash, style: 'destructive', onPress: () => run(() => emptyTrashAndFiles(db, fs)) },
    ]);

  const align = rtl ? 'right' : 'left';
  return (
    <ScrollView contentContainerStyle={s.page}>
      <SubHeader title={t.trash} onBack={onBack} c={c} rtl={rtl} t={t} />
      <Note c={c} rtl={rtl}>{t.trashNote}</Note>

      {items === null ? (
        <Text style={{ color: c.muted, fontSize: 12 }}>{t.loading}</Text>
      ) : items.length === 0 ? (
        <EmptyState c={c} title={t.trashEmpty} hint={t.trashEmptyHint} icon={Trash2} />
      ) : (
        <>
          <View style={[s.topRow, rtl && s.rowReverse]}>
            <Text style={{ color: c.muted, fontSize: 11 }}>{fmt(t.trashCount, { n: num(items.length) })}</Text>
            <Button label={t.emptyTrash} onPress={emptyAll} c={c} rtl={rtl} variant="danger" icon={Trash2} disabled={busy} style={{ minHeight: 38, paddingVertical: 7 }} />
          </View>
          {items.map((e) => (
            <View key={e.id} style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
              <Text style={{ color: c.muted, fontSize: 10, textAlign: align }}>
                {formatDateKey(e.journal_date, language, calendar, { dateStyle: 'medium' })}
                {e.deleted_at
                  ? ` · ${fmt(t.deletedOn, { date: formatDateKey(isoToDateKey(e.deleted_at) || e.journal_date, language, calendar, { dateStyle: 'medium' }) })}`
                  : ''}
              </Text>
              <Text numberOfLines={1} style={{ color: c.ink, fontSize: 15, fontWeight: '600', textAlign: align }}>
                {e.title || (e.body || '').slice(0, 52) || t.noTitle}
              </Text>
              {e.body ? (
                <Text numberOfLines={2} style={{ color: c.muted, fontSize: 11, lineHeight: 17, textAlign: align }}>{e.body}</Text>
              ) : null}
              {e.attachmentCount ? (
                <Text style={{ color: c.muted, fontSize: 10, textAlign: align }}>{fmt(t.photoCount, { n: num(e.attachmentCount) })}</Text>
              ) : null}
              <View style={[s.actions, rtl && s.rowReverse]}>
                <Button label={t.restore} onPress={() => restore(e)} c={c} rtl={rtl} variant="primary" icon={RotateCcw} disabled={busy} style={{ flex: 1 }} />
                <Button label={t.deleteForever} onPress={() => purge(e)} c={c} rtl={rtl} variant="danger" icon={Trash2} disabled={busy} style={{ flex: 1 }} />
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { paddingTop: 22, paddingBottom: 22, gap: 12 },
  rowReverse: { flexDirection: 'row-reverse' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
});
