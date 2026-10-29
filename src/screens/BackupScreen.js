import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Archive, Download, FileText, FolderOpen, Share2 } from 'lucide-react-native';
import { ScrollView, Text } from '../ui';
import { Animated, fadeInDown } from '../motion';
import { Button, Card, Note, SubHeader } from '../components/common';
import { loadSettings, saveSetting } from '../db/repository';
import { BackupError, createZipBackup, parseBackup, saveJsonExport } from '../services/backup';
import { deps } from '../platform/deps';
import { pickBackupFile } from '../platform/backupPicker';
import { shareFile } from '../platform/share';
import { canSaveToDevice, saveFileToDevice } from '../platform/saveToDevice';
import { formatDateKey } from '../calendar';
import { formatBytes, isoToDateKey, numberFormatter } from '../utils/format';
import { fmt } from '../i18n';

/** Map a parse error code to an i18n string. */
function parseErrorMsg(code, t) {
  switch (code) {
    case 'not-a-backup':      return t.errNotBackup;
    case 'bad-structure':     return t.errStructure;
    case 'unsupported-version':
    case 'newer-schema':      return t.errNewer;
    case 'corrupt-zip':
    case 'corrupt-json':      return t.errCorrupt;
    case 'unsafe-path':       return t.errUnsafe;
    case 'manifest-mismatch': return t.errStructure;
    default:                  return t.errGeneric;
  }
}

const OVERDUE_DAYS = 30;

/** Backup & restore. B1: export. B2a: pick + preview. B2b: apply. */
export default function BackupScreen({ db, t, c, rtl, language, calendar, onBack, runExternal = (fn) => fn() }) {
  const num = useMemo(() => numberFormatter(language), [language]);
  const [lastBackupAt, setLastBackupAt] = useState(null);
  const [busy, setBusy] = useState(null); // 'zip' | 'json' | 'restore' | null
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [now] = useState(() => Date.now());
  // B2a restore preview
  const [parsed, setParsed] = useState(null);   // result of parseBackup
  const [restoreError, setRestoreError] = useState('');

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

  // ── B2a: pick a file and show a read-only preview ──────────────────────────
  const pickAndPreview = useCallback(async () => {
    if (busy) return;
    setBusy('restore');
    setRestoreError('');
    setParsed(null);
    try {
      const source = await runExternal(() => pickBackupFile());
      if (!source) { setBusy(null); return; }          // user cancelled
      const result = await parseBackup(db, deps, source);
      if (!result.ok) {
        const code = result.errors && result.errors.length ? result.errors[0].code : 'parse-failed';
        setRestoreError(parseErrorMsg(code, t));
      } else {
        setParsed(result);
      }
    } catch (e) {
      console.warn('[kitty-journal] restore pick failed:', e);
      setRestoreError(t.errGeneric);
    } finally {
      setBusy(null);
    }
  }, [busy, db, t, runExternal]);

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

      {/* ── B2a: Restore card ───────────────────────────────────────────── */}
      <Animated.View entering={fadeInDown(210)}>
        <Card title={t.restoreFromFile} c={c} rtl={rtl}>
          <Text style={{ color: c.muted, fontSize: 11, lineHeight: 17, textAlign: align }}>{t.restoreHint}</Text>
          <Button
            label={busy === 'restore' ? t.restoreWorking : t.restoreFromFile}
            onPress={pickAndPreview}
            c={c} rtl={rtl}
            icon={FolderOpen}
            busy={busy === 'restore'}
            disabled={Boolean(busy)}
          />
        </Card>
      </Animated.View>

      {restoreError ? <Note c={c} rtl={rtl} tone="danger">{restoreError}</Note> : null}

      {parsed && parsed.preview ? (
        <Animated.View entering={fadeInDown(0)}>
          <RestorePreview
            preview={parsed.preview}
            warnings={parsed.warnings || []}
            t={t} c={c} rtl={rtl} num={num}
            language={language} calendar={calendar}
            onDismiss={() => { setParsed(null); setRestoreError(''); }}
          />
        </Animated.View>
      ) : null}

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

// ── Read-only preview card (B2a) ────────────────────────────────────────────
function RestorePreview({ preview, warnings, t, c, rtl, num, language, calendar, onDismiss }) {
  const align = rtl ? 'right' : 'left';
  const createdDate = preview.createdAt
    ? formatDateKey(isoToDateKey(preview.createdAt), language, calendar, { dateStyle: 'medium' })
    : '';

  const rows = [
    preview.counts?.entries != null  && { label: fmt(t.restoreNew, { n: num(preview.newEntries ?? preview.counts.entries) }) },
    preview.counts?.entries != null  && preview.duplicatesIdentical != null && { label: fmt(t.restoreDuplicates, { n: num(preview.duplicatesIdentical) }) },
    preview.duplicatesDifferent != null && preview.duplicatesDifferent > 0 && { label: fmt(t.restoreDifferent, { n: num(preview.duplicatesDifferent) }) },
    preview.missingPhotos != null && preview.missingPhotos > 0 && { label: fmt(t.restorePhotos, { n: num(preview.missingPhotos) }) },
    preview.moodConflicts != null && { label: fmt(t.restoreMoods, { n: num(preview.moodConflicts ?? 0) }) },
    preview.local?.entries != null   && { label: fmt(t.restoreLocal, { n: num(preview.local.entries) }) },
  ].filter(Boolean);

  const warnMsgs = (warnings || []).map((w) => {
    switch (w.code) {
      case 'unexpected-entry':  return t.warnUnexpected;
      case 'json-no-photos':    return t.backupTextOnly;
      case 'missing-photos':    return t.warnUnexpected;
      default:                  return null;
    }
  }).filter(Boolean);

  return (
    <Card title={t.restorePreviewTitle} c={c} rtl={rtl}>
      {createdDate ? (
        <Text style={{ color: c.muted, fontSize: 11, textAlign: align }}>{fmt(t.restoreCreated, { date: createdDate })}</Text>
      ) : null}
      <View style={{ gap: 4, marginTop: 6 }}>
        {rows.map((r, i) => (
          <Text key={i} style={{ color: c.ink, fontSize: 12, textAlign: align }}>{'• '}{r.label}</Text>
        ))}
      </View>
      {warnMsgs.map((m, i) => (
        <Note key={i} c={c} rtl={rtl}>{m}</Note>
      ))}
      <Button label={t.close} onPress={onDismiss} c={c} rtl={rtl} variant="secondary" />
    </Card>
  );
}

const s = StyleSheet.create({
  page: { paddingTop: 22, paddingBottom: 40, gap: 14 },
  status: { borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
});
