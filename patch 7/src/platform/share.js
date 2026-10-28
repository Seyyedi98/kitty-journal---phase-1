// Sharing a backup file out of the app, and picking a backup file to restore.
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { fs } from './fs';

/** Opens the system share sheet for a file inside the app's private storage. */
export async function shareFile(uri, { mimeType = 'application/octet-stream', dialogTitle } = {}) {
  if (!(await Sharing.isAvailableAsync())) return { shared: false, reason: 'unavailable' };
  await Sharing.shareAsync(uri, { mimeType, dialogTitle });
  return { shared: true };
}

/**
 * Lets the user choose a backup (.zip / .json). The picked file is copied into
 * the cache (so it can be read) and its content returned in the shape that
 * parseBackup() expects: { name, base64 } for ZIP, { name, text } for JSON.
 * Returns null when cancelled.
 */
export async function pickBackupFile() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/zip', 'application/x-zip-compressed', 'application/json', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets || !result.assets.length) return null;
  const asset = result.assets[0];
  try {
    const base64 = await fs.readBase64(asset.uri);
    // A ZIP starts with "PK" -> base64 "UEsD"; anything else is read as JSON text.
    if (base64.startsWith('UEsD')) return { name: asset.name, base64 };
    const text = await fs.readText(asset.uri);
    return { name: asset.name, text };
  } finally {
    // The cache copy can hold private journal text; do not leave it behind.
    await fs.remove(asset.uri).catch(() => {});
  }
}
