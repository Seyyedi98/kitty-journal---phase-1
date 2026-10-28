// In-memory expo-file-system (legacy path-string API).
const files = new Map(); // uri -> string content (base64 or text)
const dirs = new Set();
window.__files = files;
window.__failNextWrite = false;

export const documentDirectory = 'file:///docs/';
export const cacheDirectory = 'file:///cache/';
export const EncodingType = { Base64: 'base64', UTF8: 'utf8' };
window.__freeBytes = 50 * 1024 * 1024 * 1024;

export async function getInfoAsync(uri, opts) {
  if (files.has(uri)) return { exists: true, isDirectory: false, size: files.get(uri).length, uri };
  if (dirs.has(uri) || dirs.has(uri.replace(/\/$/, '') + '/')) return { exists: true, isDirectory: true, uri };
  return { exists: false, isDirectory: false, uri };
}
export async function makeDirectoryAsync(uri) { dirs.add(uri); }
export async function copyAsync({ from, to }) {
  if (!files.has(from)) throw new Error('copy: missing ' + from);
  files.set(to, files.get(from));
}
export async function moveAsync({ from, to }) {
  if (!files.has(from)) throw new Error('move: missing ' + from);
  files.set(to, files.get(from));
  files.delete(from);
}
export async function deleteAsync(uri) { files.delete(uri); }
export async function readAsStringAsync(uri) {
  if (!files.has(uri)) throw new Error('read: missing ' + uri);
  return files.get(uri);
}
export async function writeAsStringAsync(uri, data) {
  if (window.__failNextWrite) { window.__failNextWrite = false; throw new Error('disk full'); }
  files.set(uri, data);
}
export async function readDirectoryAsync(dir) {
  return [...files.keys()].filter((k) => k.startsWith(dir) && !k.slice(dir.length).includes('/')).map((k) => k.slice(dir.length));
}
export async function getFreeDiskStorageAsync() { return window.__freeBytes; }
