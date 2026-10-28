// Thin file-system adapter over expo-file-system's path-string API, so the
// rest of the app (and the Node tests) only depend on this small interface.
//
// SDK 54+ moved the path-string API to "expo-file-system/legacy"; SDK <= 53
// still has it at the package root. Both are tried, in that order.

let FS;
try {
  // eslint-disable-next-line global-require
  FS = require('expo-file-system/legacy');
} catch {
  // eslint-disable-next-line global-require
  FS = require('expo-file-system');
}

const BASE64 = (FS.EncodingType && FS.EncodingType.Base64) || 'base64';
const UTF8 = (FS.EncodingType && FS.EncodingType.UTF8) || 'utf8';

const documentDir = FS.documentDirectory;

export const fs = {
  attachmentsDir: `${documentDir}attachments/`,
  backupsDir: `${documentDir}backups/`,
  cacheDir: FS.cacheDirectory,

  async ensureDir(uri) {
    const info = await FS.getInfoAsync(uri);
    if (!info.exists) await FS.makeDirectoryAsync(uri, { intermediates: true });
  },
  async copy(from, to) {
    await FS.copyAsync({ from, to });
  },
  async move(from, to) {
    await FS.moveAsync({ from, to });
  },
  async exists(uri) {
    return (await FS.getInfoAsync(uri)).exists;
  },
  /** File size in bytes, or null if the file does not exist. */
  async size(uri) {
    const info = await FS.getInfoAsync(uri, { size: true });
    return info.exists ? info.size ?? 0 : null;
  },
  async remove(uri) {
    await FS.deleteAsync(uri, { idempotent: true });
  },
  async readBase64(uri) {
    return FS.readAsStringAsync(uri, { encoding: BASE64 });
  },
  async writeBase64(uri, data) {
    await FS.writeAsStringAsync(uri, data, { encoding: BASE64 });
  },
  async readText(uri) {
    return FS.readAsStringAsync(uri, { encoding: UTF8 });
  },
  async writeText(uri, text) {
    await FS.writeAsStringAsync(uri, text, { encoding: UTF8 });
  },
  async list(dirUri) {
    const info = await FS.getInfoAsync(dirUri);
    return info.exists ? FS.readDirectoryAsync(dirUri) : [];
  },
  async freeBytes() {
    try {
      return await FS.getFreeDiskStorageAsync();
    } catch {
      return null;
    }
  },
};
