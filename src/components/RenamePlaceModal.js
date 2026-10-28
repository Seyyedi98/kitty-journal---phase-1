import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui';
import { Button, Note } from './common';

/** Small dialog to name / rename a saved place. `onSave(name)` gets the trimmed text ('' removes the name). */
export default function RenamePlaceModal({ visible, initialName = '', subtitle = '', onSave, onCancel, t, c, rtl }) {
  const [draft, setDraft] = useState(initialName);
  useEffect(() => {
    if (visible) setDraft(initialName);
  }, [visible, initialName]);
  const align = rtl ? 'right' : 'left';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <View style={[s.dialog, { backgroundColor: c.paper, borderColor: c.line }]}>
          <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700', textAlign: align }}>{t.renamePlaceTitle}</Text>
          {subtitle ? <Text style={{ color: c.muted, fontSize: 11, textAlign: align }}>{subtitle}</Text> : null}
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            maxLength={120}
            returnKeyType="done"
            onSubmitEditing={() => onSave(draft.trim())}
            placeholder={t.placeNamePlaceholder}
            placeholderTextColor={c.muted}
            accessibilityLabel={t.placeName}
            style={[s.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card, textAlign: align }]}
          />
          <Note c={c} rtl={rtl}>{t.renamePlaceHint}</Note>
          <View style={[s.actions, rtl && s.rowReverse]}>
            <Button label={t.cancel} onPress={onCancel} c={c} rtl={rtl} style={{ flex: 1 }} />
            <Button label={t.placeNameSave} onPress={() => onSave(draft.trim())} c={c} rtl={rtl} variant="primary" style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  rowReverse: { flexDirection: 'row-reverse' },
  backdrop: { flex: 1, backgroundColor: '#00000066', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 420, borderRadius: 18, borderWidth: 1, padding: 18, gap: 12 },
  input: { borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 44 },
  actions: { flexDirection: 'row', gap: 8 },
});
