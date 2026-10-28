// Saving a backup to a folder the user picks (Downloads, Documents, SD card…)
// through Android's Storage Access Framework. No storage permission is needed:
// the user grants access to one folder, and only for this save.
let FS;
try {
  // eslint-disable-next-line global-require
  FS = require('expo-file-system/legacy');
} catch {
  // eslint-disable-next-line global-require
  FS = require('expo-file-system');
}

const SAF = FS.StorageAccessFramework;

export const canSaveToDevice = () => !!SAF && typeof SAF.requestDirectoryPermissionsAsync === 'function';

/** @returns {{saved:true}|{saved:false,reason:'cancelled'|'unsupported'}} */
export async function saveFileToDevice(uri, { name, mimeType = 'application/octet-stream' }) {
  if (!canSaveToDevice()) return { saved: false, reason: 'unsupported' };
  const perm = await SAF.requestDirectoryPermissionsAsync();
  if (!perm.granted) return { saved: false, reason: 'cancelled' };
  const base64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
  const bare = name.replace(/\.(zip|json)$/i, ''); // the system adds the extension from the MIME type
  const target = await SAF.createFileAsync(perm.directoryUri, bare, mimeType);
  await FS.writeAsStringAsync(target, base64, { encoding: FS.EncodingType.Base64 });
  return { saved: true };
}
