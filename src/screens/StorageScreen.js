import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Eraser, HardDrive, ScanSearch, Trash2 } from 'lucide-react-native';
import { ScrollView, Text } from '../ui';
import { Button, Card, Note, SubHeader } from '../components/common';
import { checkAttachments, cleanOrphanFiles, fileOpsActive, OWN_FILE_RE, removeBrokenReferences } from '../services/photos';
import { deps } from '../platform/deps';
import { formatBytes, numberFormatter } from '../utils/format';
import { fmt } from '../i18n';

const fs = deps.fs;

async function folderStats(dir, filter) {
  let count = 0;
  let size = 0;
  let names = [];
  try {
    names = await fs.list(dir);
  } catch {
    names = [];
  }
  for (const n of names) {
    if (filter && !filter(n)) continue;
    count += 1;
    size += (await fs.size(`${dir}${n}`)) || 0;
  }
  return { count, size, names: names.filter((n) => !filter || filter(n)) };
}

/** Storage: what the journal uses, and safe clean-up tools. */
export default function StorageScreen({ db, t, c, rtl, language, onBack, onChanged }) {
  const num = useMemo(() => numberFormatter(language), [language]);
  const align = rtl ? 'right' : 'left';
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(null); // 'check' | 'clean' | 'backups' | null
  const [message, setMessage] = useState('');
  const [missing, setMissing] = useState([]);

  const load = useCallback(async () => {
    try {
      const photos = await folderStats(fs.attachmentsDir, (n) => OWN_FILE_RE.test(n));
      const backups = await folderStats(fs.backupsDir, (n) => /\.(zip|json)$/.test(n));
      const rows = await db.getFirstAsync('SELECT COUNT(*) AS n FROM attachments');
      setStats({ photos, backups, photoRows: rows ? rows.n : 0, free: await fs.freeBytes() });
    } catch {
      setStats({ photos: { count: 0, size: 0 }, backups: { count: 0, size: 0, names: [] }, photoRows: 0, free: null });
    }
  }, [db]);
  useEffect(() => {
    load();
  }, [load]);

  const guard = async (kind, fn) => {
    if (busy) return;
    if (fileOpsActive()) {
      setMessage(t.storageBusy);
      return;
    }
    setBusy(kind);
    setMessage('');
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (e) {
      console.warn('[kitty-journal] storage action failed:', e);
      Alert.alert(t.somethingWrong, t.saveFailedHint);
    } finally {
      setBusy(null);
    }
  };

  const check = () =>
    guard('check', async () => {
      const r = await checkAttachments(db, fs);
      setMissing(r.missing);
      setMessage(r.missing.length ? fmt(t.storageMissing, { n: num(r.missing.length) }) : t.storageAllGood);
    });

  const removeBroken = () =>
    Alert.alert(t.storageRemoveBroken, t.storageRemoveBrokenConfirm, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.storageRemoveBroken,
        style: 'destructive',
        onPress: () =>
          guard('check', async () => {
            await removeBrokenReferences(db, fs, missing);
            setMissing([]);
            setMessage(t.storageAllGood);
          }),
      },
    ]);

  const clean = () =>
    guard('clean', async () => {
      const r = await cleanOrphanFiles(db, fs);
      setMessage(r.skipped ? t.storageBusy : fmt(t.storageCleaned, { n: num(r.removed) }));
    });

  const clearBackups = () => {
    if (!stats || !stats.backups.count) return;
    Alert.alert(t.storageClearBackups, t.storageClearBackupsConfirm, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.storageClearBackups,
        style: 'destructive',
        onPress: () =>
          guard('backups', async () => {
            let removed = 0;
            for (const n of stats.backups.names) {
              try {
                await fs.remove(`${fs.backupsDir}${n}`);
                removed += 1;
              } catch {
                /* leave it */
              }
            }
            setMessage(fmt(t.storageBackupsCleared, { n: num(removed) }));
          }),
      },
    ]);
  };

  const line = { color: c.ink, fontSize: 12, textAlign: align };
  return (
    <ScrollView contentContainerStyle={s.page}>
      <SubHeader title={t.storage} onBack={onBack} c={c} rtl={rtl} t={t} />

      <Card title={t.storage} c={c} rtl={rtl}>
        {stats ? (
          <View style={{ gap: 5 }}>
            <Text style={line}>{'• '}{fmt(t.storagePhotos, { n: num(stats.photoRows), size: formatBytes(stats.photos.size, language) })}</Text>
            <Text style={line}>
              {'• '}
              {stats.backups.count
                ? fmt(t.storageBackups, { n: num(stats.backups.count), size: formatBytes(stats.backups.size, language) })
                : t.storageNoBackups}
            </Text>
            {stats.free != null ? <Text style={line}>{'• '}{fmt(t.storageFree, { size: formatBytes(stats.free, language) })}</Text> : null}
          </View>
        ) : null}
      </Card>

      <Card title={t.storageCheck} c={c} rtl={rtl}>
        <Button label={busy === 'check' ? t.storageChecking : t.storageCheck} onPress={check} c={c} rtl={rtl} icon={ScanSearch} busy={busy === 'check'} disabled={Boolean(busy)} />
        {missing.length ? (
          <Button label={t.storageRemoveBroken} onPress={removeBroken} c={c} rtl={rtl} variant="secondary" icon={Trash2} disabled={Boolean(busy)} />
        ) : null}
      </Card>

      <Card title={t.storageClean} c={c} rtl={rtl}>
        <Button label={t.storageClean} onPress={clean} c={c} rtl={rtl} icon={Eraser} busy={busy === 'clean'} disabled={Boolean(busy)} />
        <Button
          label={t.storageClearBackups}
          onPress={clearBackups}
          c={c}
          rtl={rtl}
          variant="secondary"
          icon={HardDrive}
          disabled={Boolean(busy) || !stats || !stats.backups.count}
        />
      </Card>

      {message ? <Note c={c} rtl={rtl}>{message}</Note> : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { paddingTop: 22, paddingBottom: 40, gap: 14 },
});
