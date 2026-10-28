import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Archive, Download, FileText, Share2 } from 'lucide-react-native';
import { ScrollView, Text } from '../ui';
import { Animated, fadeInDown } from '../motion';
import { Button, Card, Note, SubHeader } from '../components/common';
import { loadSettings, saveSetting } from '../db/repository';
import { BackupError, createZipBackup, saveJsonExport } from '../services/backup';
import { deps } from '../platform/deps';
import { shareFile } from '../platform/share';
import { canSaveToDevice, saveFileToDevice } from '../platform/saveToDevice';
import { formatDateKey } from '../calendar';
import { formatBytes, isoToDateKey, numberFormatter } from '../utils/format';
import { fmt } from '../i18n';

const OVERDUE_DAYS = 30;

/** Backup & restore. Step B1: exporting (the restore card arrives in step B2). */
export default function BackupScreen({ db, t, c, rtl, language, calendar, onBack, runExternal = (fn) => fn() }) {
  const num = useMemo(() => numberFormatter(language), [language]);
  const [lastBackupAt, setLastBackupAt] = useState(null);
  const [busy, setBusy] = useState(null); // 'zip' | 'json' | null
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    loadSettings(db)
      .then((s) => {
        if (!cancelled && typeof s.lastBackupAt === 'string') setLastBackupAt(s.lastBackupAt);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [db]);

  const make = useCallback(
    async (kind) => {
      if (busy) return;
      setBusy(kind);
      setError('');
      setShareMessage('');
      setResult(null);
      try {
        const out = kind === 'zip' ? await createZipBackup(db, deps) : await saveJsonExport(db, deps);
        setResult({ ...out, kind });
      } catch (e) {
        console.warn('[kitty-journal] backup failed:', e);
        setError(e instanceof BackupError && e.code === 'no-space' ? t.photoNoSpace : t.backupFailed);
      } finally {
        setBusy(null);
      }
    },
    [busy, db, t],
  );

  const markBackedUp = async () => {
    const iso = new Date().toISOString();
    await saveSetting(db, 'lastBackupAt', iso);
    setLastBackupAt(iso);
  };

  const saveLocal = async () => {
    if (!result) return;
    setShareMessage('');
    try {
      const r = await runExternal(() => saveFileToDevice(result.uri, { name: result.name, mimeType: result.mimeType }));
      if (r.saved) {
        await markBackedUp();
        setShareMessage(t.savedToDevice);
      } else if (r.reason === 'unsupported') {
        setShareMessage(t.shareUnavailable);
      }
    } catch (e) {
      console.warn('[kitty-journal] save to device failed:', e);
      setShareMessage(t.saveFailed);
    }
  };

  const share = async () => {
    if (!result) return;
    setShareMessage('');
    try {
      const r = await runExternal(() => shareFile(result.uri, { mimeType: result.mimeType, dialogTitle: t.backup }));
      if (!r.shared) {
        setShareMessage(t.shareUnavailable);
        return;
      }
      // Only a file that was actually offered to the share sheet counts as "backed up".
      const iso = new Date().toISOString();
      await saveSetting(db, 'lastBackupAt', iso);
      setLastBackupAt(iso);
    } catch {
      setShareMessage(t.shareUnavailable);
    }
  };

  const daysSince = lastBackupAt ? Math.floor((now - new Date(lastBackupAt).getTime()) / 86400000) : null;
  const overdue = daysSince != null && daysSince >= OVERDUE_DAYS;
  const align = rtl ? 'right' : 'left';
  const lastDate = lastBackupAt ? formatDateKey(isoToDateKey(lastBackupAt), language, calendar, { dateStyle: 'medium' }) : '';

  return (
    <ScrollView contentContainerStyle={s.page}>
      <SubHeader title={t.backup} onBack={onBack} c={c} rtl={rtl} t={t} />
      <Note c={c} rtl={rtl}>{t.backupIntro}</Note>

      <Animated.View entering={fadeInDown(0)}>
        <View style={[s.status, { backgroundColor: lastBackupAt && !overdue ? c.sage : c.accentSoft, borderColor: c.line }]}>
          <Text style={{ color: lastBackupAt && !overdue ? c.sageDark : c.ink, fontSize: 12, fontWeight: '700', textAlign: align }}>
            {lastBackupAt ? fmt(t.lastBackup, { date: lastDate }) : t.neverBackedUp}
          </Text>
          {overdue ? (
            <Text style={{ color: c.muted, fontSize: 11, marginTop: 3, textAlign: align }}>{fmt(t.backupOverdue, { n: num(daysSince) })}</Text>
          ) : null}
        </View>
      </Animated.View>

      <Animated.View entering={fadeInDown(70)}>
        <Card title={t.exportZip} c={c} rtl={rtl}>
          <Text style={{ color: c.muted, fontSize: 11, lineHeight: 17, textAlign: align }}>{t.exportZipHint}</Text>
          <Button
            label={busy === 'zip' ? t.creatingBackup : t.exportZip}
            onPress={() => make('zip')}
            c={c}
            rtl={rtl}
            variant="primary"
            icon={Archive}
            busy={busy === 'zip'}
            disabled={Boolean(busy)}
          />
        </Card>
      </Animated.View>

      <Animated.View entering={fadeInDown(140)}>
        <Card title={t.exportJson} c={c} rtl={rtl}>
          <Text style={{ color: c.muted, fontSize: 11, lineHeight: 17, textAlign: align }}>{t.exportJsonHint}</Text>
          <Button
            label={busy === 'json' ? t.creatingBackup : t.exportJson}
            onPress={() => make('json')}
            c={c}
            rtl={rtl}
            icon={FileText}
            busy={busy === 'json'}
            disabled={Boolean(busy)}
          />
        </Card>
      </Animated.View>

      {error ? <Note c={c} rtl={rtl} tone="danger">{error}</Note> : null}

      {result ? (
        <Animated.View entering={fadeInDown(0)}>
          <Card title={t.backupReady} c={c} rtl={rtl}>
            <Text selectable style={{ color: c.ink, fontSize: 12, fontWeight: '600', textAlign: align }}>{fmt(t.backupFile, { name: result.name })}</Text>
            <Text style={{ color: c.muted, fontSize: 11, textAlign: align }}>
              {result.kind === 'zip'
                ? `${fmt(t.backupCounts, { entries: num(result.counts.entries), photos: num(result.counts.attachments) })} · ${formatBytes(result.size, language)}`
                : t.backupTextOnly}
            </Text>
            {result.missingFiles && result.missingFiles.length ? (
              <Note c={c} rtl={rtl} tone="danger">{fmt(t.backupMissingAtTime, { n: num(result.missingFiles.length) })}</Note>
            ) : null}
            {canSaveToDevice() ? <Button label={t.saveToDevice} onPress={saveLocal} c={c} rtl={rtl} variant="primary" icon={Download} /> : null}
            <Button label={t.shareBackup} onPress={share} c={c} rtl={rtl} variant="secondary" icon={Share2} />
            <Note c={c} rtl={rtl}>{t.backupShareNote}</Note>
            {shareMessage ? <Note c={c} rtl={rtl} tone={shareMessage === t.savedToDevice ? undefined : 'danger'}>{shareMessage}</Note> : null}
          </Card>
        </Animated.View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { paddingTop: 22, paddingBottom: 40, gap: 14 },
  status: { borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
});
