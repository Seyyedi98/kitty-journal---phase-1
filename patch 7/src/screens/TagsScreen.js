import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Pencil, Tag, Trash2 } from 'lucide-react-native';
import { ScrollView, Text, TextInput } from '../ui';
import EmptyState from '../components/EmptyState';
import { Button, Note, SubHeader } from '../components/common';
import { deleteTag, listTags, renameTag } from '../db/repository';
import { cleanTagName } from '../utils/text';
import { numberFormatter } from '../utils/format';
import { fmt } from '../i18n';

export default function TagsScreen({ db, t, c, rtl, language, onBack, onChanged }) {
  const [tags, setTags] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  const num = useMemo(() => numberFormatter(language), [language]);

  const load = useCallback(async () => {
    try {
      setTags(await listTags(db));
    } catch {
      setTags([]);
    }
  }, [db]);
  useEffect(() => {
    load();
  }, [load]);

  const startRename = (tag) => {
    setEditing(tag);
    setDraft(tag.name);
  };
  const saveRename = async () => {
    const name = cleanTagName(draft);
    if (!editing || !name) {
      setEditing(null);
      return;
    }
    try {
      const result = await renameTag(db, editing.id, name);
      setMessage(result && result.merged ? t.tagMerged : t.tagRenamed);
      setEditing(null);
      await load();
      onChanged?.();
    } catch {
      Alert.alert(t.somethingWrong, t.saveFailedHint);
    }
  };
  const remove = (tag) =>
    Alert.alert(t.deleteTag, t.deleteTagConfirm, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.deleteTag,
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTag(db, tag.id);
            await load();
            onChanged?.();
          } catch {
            Alert.alert(t.somethingWrong, t.saveFailedHint);
          }
        },
      },
    ]);

  const align = rtl ? 'right' : 'left';
  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <SubHeader title={t.manageTags} onBack={onBack} c={c} rtl={rtl} t={t} />
      {message ? <Note c={c} rtl={rtl} tone="ok">{message}</Note> : null}
      {tags === null ? (
        <Text style={{ color: c.muted, fontSize: 12 }}>{t.loading}</Text>
      ) : tags.length === 0 ? (
        <EmptyState c={c} title={t.noTags} hint={t.noTagsHint} icon={Tag} />
      ) : (
        tags.map((tag) => (
          <View key={tag.id} style={[s.row, { backgroundColor: c.card, borderColor: c.line }, rtl && s.rowReverse]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.ink, fontSize: 14, fontWeight: '600', textAlign: align }}>#{tag.name}</Text>
              <Text style={{ color: c.muted, fontSize: 10, marginTop: 2, textAlign: align }}>{fmt(t.tagEntries, { n: num(tag.count) })}</Text>
            </View>
            <Pressable onPress={() => startRename(tag)} style={s.icon} accessibilityRole="button" accessibilityLabel={`${t.renameTag}: ${tag.name}`}>
              <Pencil size={17} color={c.sageDark} />
            </Pressable>
            <Pressable onPress={() => remove(tag)} style={s.icon} accessibilityRole="button" accessibilityLabel={`${t.deleteTag}: ${tag.name}`}>
              <Trash2 size={17} color={c.danger} />
            </Pressable>
          </View>
        ))
      )}

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={s.backdrop}>
          <View style={[s.dialog, { backgroundColor: c.paper, borderColor: c.line }]}>
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700', textAlign: align }}>{t.renameTagTitle}</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              maxLength={40}
              onSubmitEditing={saveRename}
              returnKeyType="done"
              style={[s.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card, textAlign: align }]}
              accessibilityLabel={t.renameTagTitle}
            />
            <Note c={c} rtl={rtl}>{t.renameTagHint}</Note>
            <View style={[s.dialogActions, rtl && s.rowReverse]}>
              <Button label={t.cancel} onPress={() => setEditing(null)} c={c} rtl={rtl} style={{ flex: 1 }} />
              <Button label={t.renameTag} onPress={saveRename} c={c} rtl={rtl} variant="primary" style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { paddingTop: 22, paddingBottom: 22, gap: 10 },
  rowReverse: { flexDirection: 'row-reverse' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14, minHeight: 56 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: '#00000066', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 420, borderRadius: 18, borderWidth: 1, padding: 18, gap: 12 },
  input: { borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 44 },
  dialogActions: { flexDirection: 'row', gap: 8 },
});
